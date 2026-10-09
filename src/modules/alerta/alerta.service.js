import crypto from 'node:crypto'
import AlertaConfigModel from './alerta.model.js'
import UserModel from '../user/user.model.js'
import ContratanteModel from '../contratante/contratante.model.js'
import { telegramConfigurado, usuarioDoBot, enviarMensagem } from './telegram.js'
import { textoDoAlerta } from './alerta.textos.js'
import AppError from '../../errors/AppError.js'

const VALIDADE_DO_CODIGO_MS = 15 * 60 * 1000
const TIPOS = ['queda', 'lentidao', 'agente', 'recursos', 'ssl', 'dominio', 'emails', 'seguranca', 'faturas']

// Qual chave de "ativos" liga/desliga cada tipo de mensagem.
const GRUPO_DO_TIPO = {
    queda: 'queda', voltou: 'queda',
    lentidao: 'lentidao', lentidaoFim: 'lentidao',
    agente: 'agente', agenteVoltou: 'agente',
    ram: 'recursos', disco: 'recursos',
    ssl: 'ssl', dominio: 'dominio', emails: 'emails', seguranca: 'seguranca',
    faturaPaga: 'faturas',
}

function limite(valor, min, max, padrao) {
    const n = Number(valor)
    return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : padrao
}

async function idiomaDoTenant(tenantId) {
    const dono = await UserModel.findById(tenantId, 'idioma')
    return dono?.idioma ?? 'pt'
}

export const AlertaService = {
    async obterConfig(tenantId) {
        return await AlertaConfigModel.findOneAndUpdate(
            { tenantId },
            { $setOnInsert: { tenantId } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        )
    },

    async obterParaTela(tenantId) {
        const config = await this.obterConfig(tenantId)
        return { ...config.toJSON(), telegramDisponivel: telegramConfigurado() }
    },

    async atualizar(tenantId, body) {
        const config = await this.obterConfig(tenantId)
        const ativos = body?.ativos ?? {}
        for (const tipo of TIPOS) {
            if (tipo in ativos) config.ativos[tipo] = !!ativos[tipo]
        }
        const l = body?.limites ?? {}
        if ('ram' in l) config.limites.ram = limite(l.ram, 50, 99, 90)
        if ('disco' in l) config.limites.disco = limite(l.disco, 50, 99, 90)
        if ('diasSsl' in l) config.limites.diasSsl = limite(l.diasSsl, 1, 60, 14)
        if ('diasDominio' in l) config.limites.diasDominio = limite(l.diasDominio, 1, 120, 30)
        await config.save()
        return await this.obterParaTela(tenantId)
    },

    // Link que abre o bot já com o código: o bot recebe "/start <código>" e liga o chat à conta.
    async gerarLinkDeVinculo(tenantId) {
        if (!telegramConfigurado()) {
            throw new AppError('O Telegram ainda não está configurado no sistema. Fale com o suporte.', 503)
        }
        const config = await this.obterConfig(tenantId)
        config.codigoVinculo = crypto.randomBytes(12).toString('base64url')
        config.codigoExpira = new Date(Date.now() + VALIDADE_DO_CODIGO_MS)
        await config.save()

        const bot = await usuarioDoBot().catch(() => {
            throw new AppError('Não foi possível falar com o Telegram. Tente de novo em instantes.', 502)
        })
        return { link: `https://t.me/${bot}?start=${config.codigoVinculo}`, expiraEm: config.codigoExpira }
    },

    async desconectar(tenantId) {
        const config = await this.obterConfig(tenantId)
        config.telegram = { chatId: null, nome: null, conectadoEm: null }
        await config.save()
        return await this.obterParaTela(tenantId)
    },

    async testar(tenantId) {
        const config = await this.obterConfig(tenantId)
        if (!config.telegram?.chatId) {
            throw new AppError('Conecte o Telegram antes de testar', 400)
        }
        try {
            await enviarMensagem(config.telegram.chatId, textoDoAlerta(await idiomaDoTenant(tenantId), 'teste'))
        } catch {
            throw new AppError('O Telegram não aceitou a mensagem. Confira se o bot não foi bloqueado ou removido do grupo.', 502)
        }
        return null
    },

    // Mensagem recebida pelo bot (webhook ou consulta). Só trata "/start <código>".
    async processarMensagemDoBot(mensagem) {
        const texto = String(mensagem?.text ?? '').trim()
        const chat = mensagem?.chat
        if (!chat?.id || !texto.startsWith('/start')) return

        const codigo = texto.split(/\s+/)[1]
        if (!codigo) {
            await enviarMensagem(chat.id, textoDoAlerta('pt', 'boasVindas')).catch(() => null)
            return
        }

        // Código do cliente final (portal) começa com "c_".
        if (codigo.startsWith('c_')) {
            const contratante = await ContratanteModel.findOne({ codigoVinculo: codigo, codigoExpira: { $gt: new Date() } })
            if (!contratante) {
                await enviarMensagem(chat.id, textoDoAlerta('pt', 'codigoInvalido')).catch(() => null)
                return
            }
            contratante.telegram = {
                chatId: String(chat.id),
                nome: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || null,
                conectadoEm: new Date(),
            }
            contratante.codigoVinculo = null
            contratante.codigoExpira = null
            await contratante.save()
            await enviarMensagem(chat.id, textoDoAlerta(contratante.idioma, 'conectadoCliente', { nome: contratante.nome })).catch(() => null)
            return
        }

        const config = await AlertaConfigModel.findOne({ codigoVinculo: codigo, codigoExpira: { $gt: new Date() } })
        if (!config) {
            await enviarMensagem(chat.id, textoDoAlerta('pt', 'codigoInvalido')).catch(() => null)
            return
        }

        config.telegram = {
            chatId: String(chat.id),
            nome: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || null,
            conectadoEm: new Date(),
        }
        config.codigoVinculo = null
        config.codigoExpira = null
        await config.save()

        const dono = await UserModel.findById(config.tenantId, 'nomeEmpresa idioma')
        await enviarMensagem(chat.id, textoDoAlerta(dono?.idioma ?? 'pt', 'conectado', { empresa: dono?.nomeEmpresa ?? '' })).catch(() => null)
    },

    // Usado pelo monitor. Respeita o que a conta ligou/desligou; falha do Telegram nunca derruba o monitor.
    async notificar(tenantId, tipo, dados) {
        if (!telegramConfigurado()) return false
        const config = await AlertaConfigModel.findOne({ tenantId })
        if (!config?.telegram?.chatId || config.ativos?.[GRUPO_DO_TIPO[tipo]] === false) return false
        try {
            await enviarMensagem(config.telegram.chatId, textoDoAlerta(await idiomaDoTenant(tenantId), tipo, dados))
            return true
        } catch (error) {
            console.error(`Alerta do Telegram não enviado (${tipo}):`, error.message)
            return false
        }
    },

    // Lembrete para o cliente final (fatura, domínio, e-mails), no Telegram dele.
    async notificarContratante(contratante, tipo, dados) {
        if (!telegramConfigurado() || !contratante?.telegram?.chatId) return false
        try {
            await enviarMensagem(contratante.telegram.chatId, textoDoAlerta(contratante.idioma, tipo, dados))
            return true
        } catch (error) {
            console.error(`Alerta do Telegram (cliente) não enviado (${tipo}):`, error.message)
            return false
        }
    },

    async limitesDoTenant(tenantId) {
        const config = await AlertaConfigModel.findOne({ tenantId })
        return config?.limites ?? { ram: 90, disco: 90, diasSsl: 14, diasDominio: 30 }
    },
}
