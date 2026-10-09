import crypto from 'node:crypto'
import argon2 from 'argon2'
import ContratanteModel from '../contratante/contratante.model.js'
import FaturaModel, { faturaVencida } from '../contratante/fatura.model.js'
import ServidorModel from '../servidor/servidor.model.js'
import IncidenteModel from '../servidor/incidente.model.js'
import SiteModel from '../site/site.model.js'
import UserModel from '../user/user.model.js'
import RecebimentoModel from '../recebimento/recebimento.model.js'
import { ServidorService } from '../servidor/servidor.service.js'
import { AssinaturaService } from '../assinatura/assinatura.service.js'
import { FaturaService } from '../contratante/fatura.service.js'
import { normalizarEmail } from '../contratante/contratante.dto.js'
import { assinarTokensDoPortal, lerToken } from './portal.auth.js'
import { hashDoToken } from '../shared/utils/cripto.js'
import { gatewayDoPais } from '../shared/utils/pais.js'
import { telegramConfigurado, usuarioDoBot } from '../alerta/telegram.js'
import AppError from '../../errors/AppError.js'
import { exigirId } from '../shared/utils/ids.js'

const DIA_MS = 24 * 60 * 60 * 1000
const VALIDADE_DO_CODIGO_MS = 15 * 60 * 1000

function fusoValido(tz) {
    try {
        Intl.DateTimeFormat('en-US', { timeZone: tz })
        return tz
    } catch {
        return 'UTC'
    }
}

async function emitirSessao(contratante) {
    const tokens = assinarTokensDoPortal(contratante)
    contratante.tokenRefresh = tokens.refreshToken
    contratante.ultimoAcesso = new Date()
    await contratante.save()
    return { ...tokens, contratante: contratante.toJSON() }
}

async function buscarPeloLink(token) {
    const contratante = await ContratanteModel.findOne({ conviteHash: hashDoToken(token), conviteExpira: { $gt: new Date() } })
    if (!contratante) {
        throw new AppError('Este link de acesso não vale mais. Peça um novo ao responsável pelo seu sistema.', 404)
    }
    return contratante
}

async function buscar(id) {
    const contratante = await ContratanteModel.findById(id)
    if (!contratante) {
        throw new AppError('Sessão expirada. Entre novamente.', 401)
    }
    return contratante
}

export const PortalService = {
    // ----- Acesso -----

    async dadosDoLink(token) {
        const contratante = await buscarPeloLink(token)
        const dono = await UserModel.findById(contratante.tenantId, 'nomeEmpresa')
        return { nome: contratante.nome, email: contratante.email, empresa: dono?.nomeEmpresa ?? '', idioma: contratante.idioma, temSenha: !!contratante.password }
    },

    async criarSenha(token, senha) {
        if (!senha || String(senha).length < 6) {
            throw new AppError('A senha deve ter ao menos 6 caracteres', 400)
        }
        const contratante = await buscarPeloLink(token)
        contratante.password = await argon2.hash(String(senha))
        contratante.conviteHash = null
        contratante.conviteExpira = null
        return await emitirSessao(contratante)
    },

    // O mesmo e-mail pode ser cliente de mais de um programador: vale a conta cuja senha confere.
    async login(body) {
        const email = normalizarEmail(body?.email)
        const senha = String(body?.password ?? '')
        const candidatos = email ? await ContratanteModel.find({ email, password: { $ne: null } }).sort({ ultimoAcesso: -1 }) : []
        for (const contratante of candidatos) {
            if (await argon2.verify(contratante.password, senha).catch(() => false)) {
                return await emitirSessao(contratante)
            }
        }
        throw new AppError('E-mail ou senha incorretos', 401)
    },

    async refresh(refreshToken) {
        let dados
        try {
            dados = lerToken(refreshToken)
        } catch {
            throw new AppError('Sessão expirada. Entre novamente.', 401)
        }
        const contratante = await ContratanteModel.findById(dados.cid)
        if (!contratante || dados.tipo !== 'refresh' || contratante.tokenRefresh !== refreshToken) {
            throw new AppError('Sessão expirada. Entre novamente.', 401)
        }
        return { accessToken: assinarTokensDoPortal(contratante).accessToken }
    },

    async logout(id) {
        await ContratanteModel.updateOne({ _id: id }, { $set: { tokenRefresh: null } })
        return null
    },

    async atualizarMe(id, body) {
        const contratante = await buscar(id)
        if (body?.idioma) contratante.idioma = body.idioma === 'en' ? 'en' : 'pt'
        await contratante.save()
        return contratante
    },

    async trocarSenha(id, body) {
        const contratante = await buscar(id)
        if (!body?.newPassword || String(body.newPassword).length < 6) {
            throw new AppError('A senha deve ter ao menos 6 caracteres', 400)
        }
        if (!(await argon2.verify(contratante.password, String(body?.currentPassword ?? '')).catch(() => false))) {
            throw new AppError('Senha atual incorreta', 400)
        }
        contratante.password = await argon2.hash(String(body.newPassword))
        await contratante.save()
        return null
    },

    // O portal fica fora do ar se a conta do programador estiver com a assinatura parada.
    async exigirContaDoProgramadorAtiva(contratante) {
        const { liberado } = await AssinaturaService.verificarAcesso(contratante.tenantId)
        if (!liberado) {
            throw new AppError('O painel está indisponível no momento. Fale com o responsável pelo seu sistema.', 402)
        }
    },

    // ----- Tudo o que o cliente vê, numa chamada só -----

    async resumo(id, tz) {
        const contratante = await buscar(id)
        await this.exigirContaDoProgramadorAtiva(contratante)
        const fuso = fusoValido(tz)
        const desde = new Date(Date.now() - 30 * DIA_MS)

        const [dono, servidores, sites, faturas, recebimento] = await Promise.all([
            UserModel.findById(contratante.tenantId, 'nomeEmpresa email telefone'),
            ServidorModel.find({ tenantId: contratante.tenantId, _id: { $in: contratante.servidores } }).sort({ nome: 1 }),
            SiteModel.find({ tenantId: contratante.tenantId, _id: { $in: contratante.sites } }).sort({ dominio: 1 }),
            FaturaModel.find({ contratanteId: contratante._id, status: { $ne: 'cancelada' } }).sort({ vencimento: -1 }).limit(24),
            RecebimentoModel.findOne({ tenantId: contratante.tenantId }),
        ])

        // Só o essencial, sem detalhes técnicos (pacotes, dependências, logs).
        const listaDeServidores = await Promise.all(servidores.map(async (s) => {
            const [disponibilidade, incidentes] = await Promise.all([
                ServidorService.disponibilidade30Dias(s, fuso),
                IncidenteModel.find({ servidorId: s._id, inicio: { $gte: desde } }),
            ])
            const quedas = incidentes.filter((i) => i.tipo === 'queda')
            return {
                _id: s._id,
                nome: s.nome,
                status: s.status,
                statusDesde: s.statusDesde,
                endereco: s.url ? new URL(s.url).hostname : null,
                tempoDeResposta: s.ultimaVerificacao?.ms ?? null,
                verificadoEm: s.ultimaVerificacao?.em ?? s.agente?.ultimoContato ?? null,
                ssl: s.ssl?.expiraEm ? { expiraEm: s.ssl.expiraEm, valido: s.ssl.valido } : null,
                disponibilidade,
                quedas30d: quedas.length,
                minutosFora30d: Math.round(quedas.reduce((soma, i) => soma + ((i.fim ?? new Date()) - i.inicio), 0) / 60000),
                lentidoes30d: incidentes.filter((i) => i.tipo === 'lentidao').length,
            }
        }))

        const listaDeSites = sites.map((s) => ({
            _id: s._id,
            dominio: s.dominio,
            dominioExpiraEm: s.manual?.expiraEm ?? s.registro?.expiraEm ?? null,
            registrador: s.manual?.registrador ?? s.registro?.registrador ?? null,
            renovacaoAutomatica: !!s.manual?.renovacaoAutomatica,
            valorRenovacao: s.manual?.valorRenovacao ?? null,
            moedaRenovacao: s.manual?.moeda ?? null,
            linkRenovacao: s.manual?.linkRenovacao ?? null,
            ssl: s.ssl?.expiraEm ? { expiraEm: s.ssl.expiraEm, valido: s.ssl.valido } : null,
            emails: s.emails?.provedor || s.emails?.provedorDetectado || s.emails?.vencimento
                ? {
                    provedor: s.emails.provedor ?? s.emails.provedorDetectado ?? null,
                    vencimento: s.emails.vencimento ?? null,
                    valor: s.emails.valor ?? null,
                    moeda: s.emails.moeda ?? null,
                    periodicidade: s.emails.periodicidade ?? null,
                    caixas: s.emails.caixas?.length ?? 0,
                    linkRenovacao: s.emails.linkRenovacao ?? null,
                }
                : null,
        }))

        // Os três selos do topo do portal, calculados com dados reais (sem expor os detalhes técnicos).
        const agora = new Date()
        const sslOk = (ssl) => !ssl?.expiraEm || (ssl.valido !== false && new Date(ssl.expiraEm) > agora)
        const pendenciasDeSeguranca = servidores.reduce((soma, s) => soma
            + (s.pacotes?.lista ?? []).filter((p) => p.seguranca).length
            + (s.dependencias ?? []).filter((d) => d.vulneravel).length, 0)
        const indicadores = {
            sistema: !servidores.length ? null
                : servidores.some((s) => s.status === 'offline') ? 'fora'
                    : servidores.every((s) => s.status === 'online') ? 'ok' : 'atencao',
            seguranca: !servidores.length && !sites.length ? null
                : pendenciasDeSeguranca === 0 && servidores.every((s) => sslOk(s.ssl)) && sites.every((s) => sslOk(s.ssl)) ? 'ok' : 'atencao',
            pagamento: !faturas.length && !contratante.cobranca?.ativa ? null
                : faturas.some((f) => faturaVencida(f, agora)) ? 'atrasado' : 'ok',
        }

        const gateway = gatewayDoPais(contratante.pais)
        const conectado = gateway === 'mercadopago' ? !!recebimento?.mercadoPago?.chaveCifrada : !!recebimento?.stripe?.chaveCifrada

        return {
            contratante: contratante.toJSON(),
            indicadores,
            responsavel: { empresa: dono?.nomeEmpresa ?? '', email: dono?.email ?? null, telefone: dono?.telefone ?? null },
            servidores: listaDeServidores,
            sites: listaDeSites,
            faturas,
            pagamento: { gateway, disponivel: conectado },
            telegram: { disponivel: telegramConfigurado(), conectado: !!contratante.telegram?.chatId, nome: contratante.telegram?.nome ?? null },
        }
    },

    // ----- Faturas -----

    async pagar(id, faturaId) {
        exigirId(faturaId, 'Fatura não encontrada')
        const contratante = await buscar(id)
        await this.exigirContaDoProgramadorAtiva(contratante)
        return await FaturaService.linkDePagamento(contratante, faturaId)
    },

    // Volta do pagamento: confere no gateway sem esperar a rotina.
    async conferirFatura(id, faturaId) {
        exigirId(faturaId, 'Fatura não encontrada')
        const fatura = await FaturaModel.findOne({ _id: faturaId, contratanteId: id })
        if (!fatura) {
            throw new AppError('Fatura não encontrada', 404)
        }
        return await FaturaService.sincronizar(fatura).catch(() => fatura)
    },

    // ----- Telegram do cliente -----

    async linkDoTelegram(id) {
        if (!telegramConfigurado()) {
            throw new AppError('O Telegram ainda não está configurado no sistema. Fale com o suporte.', 503)
        }
        const contratante = await buscar(id)
        // Prefixo "c_" diferencia o código do cliente final do código do programador.
        contratante.codigoVinculo = `c_${crypto.randomBytes(12).toString('base64url')}`
        contratante.codigoExpira = new Date(Date.now() + VALIDADE_DO_CODIGO_MS)
        await contratante.save()
        const bot = await usuarioDoBot().catch(() => {
            throw new AppError('Não foi possível falar com o Telegram. Tente de novo em instantes.', 502)
        })
        return { link: `https://t.me/${bot}?start=${contratante.codigoVinculo}`, expiraEm: contratante.codigoExpira }
    },

    async desconectarTelegram(id) {
        const contratante = await buscar(id)
        contratante.telegram = { chatId: null, nome: null, conectadoEm: null }
        await contratante.save()
        return null
    },
}
