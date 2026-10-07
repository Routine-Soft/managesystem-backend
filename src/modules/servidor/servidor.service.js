import mongoose from 'mongoose'
import ServidorModel from './servidor.model.js'
import MetricaModel from './metrica.model.js'
import VerificacaoModel from './verificacao.model.js'
import IncidenteModel from './incidente.model.js'
import EventoModel from './evento.model.js'
import SiteModel from '../site/site.model.js'
import { AssinaturaService } from '../assinatura/assinatura.service.js'
import { servidorDTO } from './servidor.dto.js'
import { gerarTokenDoAgente, comandoDeInstalacao, comandoDeRemocao } from './servidor.token.js'
import AppError from '../../errors/AppError.js'
import { exigirId } from '../shared/utils/ids.js'

const DIA_MS = 24 * 60 * 60 * 1000

// Fuso vindo do navegador (para os dias do gráfico baterem com o dia do cliente). Inválido = UTC.
function fusoValido(tz) {
    try {
        Intl.DateTimeFormat('en-US', { timeZone: tz })
        return tz
    } catch {
        return 'UTC'
    }
}

function resumoDoServidor(s) {
    const lista = s.pacotes?.lista ?? []
    return {
        ...s.toJSON(),
        pendencias: {
            sistemaSeguranca: lista.filter((p) => p.seguranca).length,
            sistemaOutras: lista.filter((p) => !p.seguranca).length,
            dependencias: s.dependencias?.length ?? 0,
            dependenciasVulneraveis: s.dependencias?.filter((d) => d.vulneravel).length ?? 0,
        },
    }
}

async function buscarDoTenant(tenantId, id) {
    exigirId(id, 'Servidor não encontrado')
    const servidor = await ServidorModel.findOne({ _id: id, tenantId })
    if (!servidor) {
        throw new AppError('Servidor não encontrado', 404)
    }
    return servidor
}

export const ServidorService = {
    async listar(tenantId) {
        const servidores = await ServidorModel.find({ tenantId }).sort({ nome: 1 })
        return servidores.map(resumoDoServidor)
    },

    async criar(tenantId, body) {
        const dto = servidorDTO(body ?? {})
        if (!dto.nome) {
            throw new AppError('Informe o nome do servidor', 400)
        }

        const { servidores: limite } = await AssinaturaService.limitesDoPlano(tenantId)
        if (limite !== null && (await ServidorModel.countDocuments({ tenantId })) >= limite) {
            throw new AppError('Seu plano permite até {limite} servidores. Troque de plano para adicionar mais.', 403, 'LIMITE_DO_PLANO', { limite })
        }

        const { token, hash } = gerarTokenDoAgente()
        const servidor = await ServidorModel.create({ ...dto, tenantId, tokenHash: hash })
        return { servidor: resumoDoServidor(servidor), comando: comandoDeInstalacao(token), comandoRemocao: comandoDeRemocao() }
    },

    async atualizar(tenantId, id, body) {
        const servidor = await buscarDoTenant(tenantId, id)
        const dto = servidorDTO(body ?? {})
        if ('nome' in dto && !dto.nome) delete dto.nome

        // Endereço trocado: o histórico de verificações antigo não vale mais para o estado atual.
        if ('url' in dto && dto.url !== servidor.url) {
            servidor.falhasSeguidas = 0
            servidor.lentasSeguidas = 0
            servidor.ssl = {}
            servidor.ultimaVerificacao = {}
        }
        Object.assign(servidor, dto)
        await servidor.save()
        return resumoDoServidor(servidor)
    },

    async remover(tenantId, id) {
        const servidor = await buscarDoTenant(tenantId, id)
        await Promise.all([
            MetricaModel.deleteMany({ servidorId: servidor._id }),
            VerificacaoModel.deleteMany({ servidorId: servidor._id }),
            IncidenteModel.deleteMany({ servidorId: servidor._id }),
            EventoModel.deleteMany({ servidorId: servidor._id }),
            SiteModel.updateMany({ tenantId, servidorId: servidor._id }, { $set: { servidorId: null } }),
        ])
        await servidor.deleteOne()
        return null
    },

    // Gera um token novo (o antigo para de funcionar) e devolve o comando para instalar de novo.
    async novoComando(tenantId, id) {
        const servidor = await buscarDoTenant(tenantId, id)
        const { token, hash } = gerarTokenDoAgente()
        servidor.tokenHash = hash
        await servidor.save()
        return { comando: comandoDeInstalacao(token), comandoRemocao: comandoDeRemocao() }
    },

    async verificarAgora(tenantId, id) {
        const servidor = await buscarDoTenant(tenantId, id)
        servidor.agente.inventarioPendente = true
        await servidor.save()
        return null
    },

    // Tudo o que a tela do servidor mostra, numa chamada só.
    async painel(tenantId, id, { periodo = '24h', tz } = {}) {
        const servidor = await buscarDoTenant(tenantId, id)
        const fuso = fusoValido(tz)
        const agora = new Date()
        const horas = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 }[periodo] ?? 24
        const desde = new Date(agora.getTime() - horas * 60 * 60 * 1000)
        // Pontos do gráfico: ~ 1 por 5 min em 24 h; períodos maiores juntam mais minutos por ponto.
        const balde = { 1: 1, 24: 5, 168: 30, 720: 120 }[horas] ?? 5

        const [serie, pico24h, disponibilidade, incidentes, eventos, site] = await Promise.all([
            MetricaModel.aggregate([
                { $match: { servidorId: servidor._id, em: { $gte: desde } } },
                {
                    $group: {
                        _id: { $dateTrunc: { date: '$em', unit: 'minute', binSize: balde } },
                        cpu: { $avg: '$cpu' },
                        ramUsada: { $avg: '$ramUsada' },
                        ramMax: { $max: '$ramUsada' },
                        ramTotal: { $max: '$ramTotal' },
                        discoPct: { $avg: '$discoPct' },
                        req: { $sum: '$req' },
                        req4xx: { $sum: '$req4xx' },
                        req5xx: { $sum: '$req5xx' },
                        erros: { $sum: '$erros' },
                    },
                },
                { $sort: { _id: 1 } },
                { $project: { _id: 0, em: '$_id', cpu: 1, ramUsada: 1, ramMax: 1, ramTotal: 1, discoPct: 1, req: 1, req4xx: 1, req5xx: 1, erros: 1 } },
            ]),
            MetricaModel.findOne({ servidorId: servidor._id, em: { $gte: new Date(agora.getTime() - DIA_MS) } }).sort({ ramUsada: -1 }).select('ramUsada em'),
            this.disponibilidade30Dias(servidor, fuso),
            IncidenteModel.find({ servidorId: servidor._id, inicio: { $gte: new Date(agora.getTime() - 30 * DIA_MS) } }).sort({ inicio: -1 }).limit(50),
            EventoModel.find({ servidorId: servidor._id }).sort({ em: -1 }).limit(40),
            this.siteDoServidor(servidor),
        ])

        const quedas = incidentes.filter((i) => i.tipo === 'queda')
        return {
            servidor: resumoDoServidor(servidor),
            periodo,
            serie,
            picoRam24h: pico24h ? { valor: pico24h.ramUsada, em: pico24h.em } : null,
            disponibilidade,
            incidentes: {
                lista: incidentes,
                quedas30d: quedas.length,
                minutosFora30d: Math.round(quedas.reduce((soma, i) => soma + ((i.fim ?? agora) - i.inicio), 0) / 60000),
                lentidoes30d: incidentes.filter((i) => i.tipo === 'lentidao').length,
            },
            eventos,
            site,
        }
    },

    // Um quadradinho por dia (30 dias): verde, queda ou lentidão, e o % no ar.
    // Com URL, conta as verificações de fora; sem URL, conta os minutos em que o agente deu sinal.
    async disponibilidade30Dias(servidor, fuso) {
        const desde = new Date(Date.now() - 30 * DIA_MS)
        const porDia = { $dateToString: { date: '$em', format: '%Y-%m-%d', timezone: fuso } }

        let dias
        if (servidor.url) {
            dias = await VerificacaoModel.aggregate([
                { $match: { servidorId: servidor._id, em: { $gte: desde } } },
                { $group: { _id: porDia, total: { $sum: 1 }, ok: { $sum: { $cond: ['$ok', 1, 0] } }, lentas: { $sum: { $cond: ['$lento', 1, 0] } } } },
            ])
        } else {
            dias = await MetricaModel.aggregate([
                { $match: { servidorId: servidor._id, em: { $gte: desde } } },
                { $group: { _id: porDia, ok: { $sum: 1 } } },
            ])
            // Sem URL, cada minuto sem leitura conta como fora (exceto no primeiro e no dia de hoje, que estão incompletos).
            dias = dias.map((d) => ({ ...d, total: 1440, lentas: 0 }))
        }

        const incidentes = await IncidenteModel.find({ servidorId: servidor._id, $or: [{ fim: null }, { fim: { $gte: desde } }] })
        const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' })
        const diasComIncidente = {}
        // Queda pesa mais que lentidão: um dia com as duas aparece como queda.
        const marcar = (dia, tipo) => {
            diasComIncidente[dia] = diasComIncidente[dia] === 'queda' || tipo === 'queda' ? 'queda' : 'lentidao'
        }
        for (const inc of incidentes) {
            const fim = inc.fim ?? new Date()
            for (let t = Math.max(inc.inicio.getTime(), desde.getTime()); t < fim.getTime(); t += DIA_MS) {
                marcar(fmt.format(new Date(t)), inc.tipo)
            }
            marcar(fmt.format(fim), inc.tipo)
        }

        const mapa = Object.fromEntries(dias.map((d) => [d._id, d]))
        const hoje = fmt.format(new Date())
        const primeiroDia = fmt.format(servidor.createdAt)
        const resultado = []
        let somaOk = 0
        let somaTotal = 0
        for (let i = 29; i >= 0; i--) {
            const dia = fmt.format(new Date(Date.now() - i * DIA_MS))
            const d = mapa[dia]
            if (!d || dia < primeiroDia) {
                resultado.push({ dia, estado: 'sem_dados', pct: null })
                continue
            }
            const total = servidor.url || (dia !== hoje && dia !== primeiroDia) ? d.total : d.ok
            const pct = total ? Math.min(100, (d.ok / total) * 100) : null
            somaOk += d.ok
            somaTotal += total
            resultado.push({ dia, estado: diasComIncidente[dia] ?? 'ok', pct })
        }

        return { dias: resultado, pct: somaTotal ? Math.min(100, (somaOk / somaTotal) * 100) : null }
    },

    // Site cadastrado com o mesmo domínio da URL do servidor, ou ligado a ele.
    async siteDoServidor(servidor) {
        const porLigacao = await SiteModel.findOne({ tenantId: servidor.tenantId, servidorId: servidor._id })
        if (porLigacao) return porLigacao
        if (!servidor.url) return null
        const host = new URL(servidor.url).hostname.replace(/^www\./, '')
        const partes = host.split('.')
        const candidatos = partes.map((_, i) => partes.slice(i).join('.')).filter((d) => d.includes('.'))
        return await SiteModel.findOne({ tenantId: servidor.tenantId, dominio: { $in: candidatos } }).sort({ dominio: -1 })
    },

    // Resumo da página inicial: todos os servidores e o que precisa de atenção.
    async resumoGeral(tenantId) {
        const tid = new mongoose.Types.ObjectId(String(tenantId))
        const desde = new Date(Date.now() - 30 * DIA_MS)
        const [servidores, quedas30d, sites] = await Promise.all([
            this.listar(tenantId),
            IncidenteModel.countDocuments({ tenantId: tid, tipo: 'queda', inicio: { $gte: desde } }),
            SiteModel.find({ tenantId }).sort({ dominio: 1 }),
        ])
        return { servidores, quedas30d, sites }
    },
}
