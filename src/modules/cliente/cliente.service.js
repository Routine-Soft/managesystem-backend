import UserModel from '../user/user.model.js'
import AssinaturaModel from '../assinatura/assinatura.model.js'
import PagamentoModel from '../assinatura/pagamento.model.js'
import ServidorModel from '../servidor/servidor.model.js'
import SiteModel from '../site/site.model.js'
import PlanoModel from '../plano/plano.model.js'
import { avaliarAcesso, DIA_EM_MS } from '../assinatura/assinatura.acesso.js'
import AppError from '../../errors/AppError.js'
import { exigirId } from '../shared/utils/ids.js'

// Painel do super_admin: as contas (cada dono "admin" é um cliente), suas assinaturas e a receita.

async function assinaturaDoCliente(tenantId) {
    exigirId(tenantId, 'Cliente não encontrado')
    const assinatura = await AssinaturaModel.findOne({ tenantId }).sort({ createdAt: -1 })
    if (!assinatura) {
        throw new AppError('Cliente não encontrado', 404)
    }
    return assinatura
}

export const ClienteService = {
    async listar() {
        const donos = await UserModel.find({ role: 'admin', $expr: { $eq: ['$_id', '$tenantId'] } }).sort({ createdAt: -1 })
        const ids = donos.map((d) => d._id)

        const [assinaturas, servidores, sites] = await Promise.all([
            AssinaturaModel.find({ tenantId: { $in: ids } }).sort({ createdAt: -1 }).populate('planoId', 'nome tipo'),
            ServidorModel.aggregate([{ $match: { tenantId: { $in: ids } } }, { $group: { _id: '$tenantId', total: { $sum: 1 } } }]),
            SiteModel.aggregate([{ $match: { tenantId: { $in: ids } } }, { $group: { _id: '$tenantId', total: { $sum: 1 } } }]),
        ])

        const assinaturaPor = new Map()
        for (const a of assinaturas) if (!assinaturaPor.has(String(a.tenantId))) assinaturaPor.set(String(a.tenantId), a)
        const servidoresPor = new Map(servidores.map((s) => [String(s._id), s.total]))
        const sitesPor = new Map(sites.map((s) => [String(s._id), s.total]))

        return donos.map((dono) => {
            const assinatura = assinaturaPor.get(String(dono._id)) ?? null
            return {
                id: dono._id,
                nomeEmpresa: dono.nomeEmpresa,
                nomeCompleto: dono.nomeCompleto,
                email: dono.email,
                telefone: dono.telefone,
                idioma: dono.idioma,
                criadoEm: dono.createdAt,
                servidores: servidoresPor.get(String(dono._id)) ?? 0,
                sites: sitesPor.get(String(dono._id)) ?? 0,
                assinatura: assinatura && {
                    status: assinatura.status,
                    cobranca: assinatura.cobranca,
                    plano: assinatura.planoId?.nome ?? null,
                    dataFimTrial: assinatura.dataFimTrial,
                    proximaCobranca: assinatura.proximaCobranca,
                    acessoRevogado: assinatura.acessoRevogado,
                    acesso: avaliarAcesso(assinatura),
                },
            }
        })
    },

    async resumo() {
        const agora = new Date()
        const inicioDoMes = new Date(agora.getFullYear(), agora.getMonth(), 1)
        const [clientes, assinaturas, receita] = await Promise.all([
            UserModel.countDocuments({ role: 'admin', $expr: { $eq: ['$_id', '$tenantId'] } }),
            AssinaturaModel.aggregate([{ $sort: { createdAt: -1 } }, { $group: { _id: '$tenantId', status: { $first: '$status' } } }, { $group: { _id: '$status', total: { $sum: 1 } } }]),
            PagamentoModel.aggregate([
                { $match: { status: 'aprovado', aprovadoEm: { $gte: inicioDoMes } } },
                { $group: { _id: '$moeda', total: { $sum: '$valor' }, quantidade: { $sum: 1 } } },
            ]),
        ])
        return {
            clientes,
            porStatus: Object.fromEntries(assinaturas.map((a) => [a._id, a.total])),
            receitaDoMes: receita.map((r) => ({ moeda: r._id, total: r.total, quantidade: r.quantidade })),
            servidores: await ServidorModel.estimatedDocumentCount(),
        }
    },

    async estenderTeste(tenantId, dias) {
        const n = Number(dias)
        if (!Number.isInteger(n) || n < 1 || n > 365) {
            throw new AppError('Informe de 1 a 365 dias', 400)
        }
        const assinatura = await assinaturaDoCliente(tenantId)
        if (!['trial', 'expirada', 'pendente'].includes(assinatura.status)) {
            throw new AppError('Só dá para estender o teste de quem ainda não assinou', 400)
        }
        const base = assinatura.dataFimTrial && assinatura.dataFimTrial > new Date() ? assinatura.dataFimTrial : new Date()
        assinatura.dataFimTrial = new Date(base.getTime() + n * DIA_EM_MS)
        assinatura.status = 'trial'
        await assinatura.save()
        return assinatura
    },

    // Libera um plano pago sem cobrança (cortesia, pagamento por fora) até a data informada.
    async liberarManual(tenantId, planoId, ate) {
        const assinatura = await assinaturaDoCliente(tenantId)
        exigirId(planoId, 'Plano não encontrado')
        const plano = await PlanoModel.findById(planoId)
        const fim = new Date(ate)
        if (!plano) {
            throw new AppError('Plano não encontrado', 404)
        }
        if (Number.isNaN(fim.getTime()) || fim <= new Date()) {
            throw new AppError('Informe uma data no futuro', 400)
        }
        if (['stripe', 'recorrente'].includes(assinatura.cobranca) && ['ativa', 'inadimplente'].includes(assinatura.status)) {
            throw new AppError('Este cliente paga no cartão (renova sozinho). Cancele a assinatura no cartão antes de liberar manualmente.', 409)
        }
        assinatura.planoId = plano._id
        assinatura.status = 'ativa'
        assinatura.cobranca = 'manual'
        assinatura.proximaCobranca = fim
        assinatura.inadimplenteDesde = null
        await assinatura.save()
        return assinatura
    },

    async definirBloqueio(tenantId, bloqueado) {
        const assinatura = await assinaturaDoCliente(tenantId)
        assinatura.acessoRevogado = !!bloqueado
        await assinatura.save()
        return assinatura
    },
}
