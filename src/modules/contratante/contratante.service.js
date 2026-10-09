import crypto from 'node:crypto'
import ContratanteModel from './contratante.model.js'
import FaturaModel, { faturaVencida } from './fatura.model.js'
import ServidorModel from '../servidor/servidor.model.js'
import SiteModel from '../site/site.model.js'
import { FaturaService, urlDoPortal } from './fatura.service.js'
import { contratanteDTO, ajustarMoeda } from './contratante.dto.js'
import { hashDoToken } from '../shared/utils/cripto.js'
import { ehBrasil } from '../shared/utils/pais.js'
import AppError from '../../errors/AppError.js'
import { exigirId } from '../shared/utils/ids.js'

const VALIDADE_DO_LINK_MS = 7 * 24 * 60 * 60 * 1000

function erroDeEmailDuplicado(error) {
    if (error.code === 11000) {
        return new AppError('Você já tem um cliente com este e-mail', 409)
    }
    return error
}

async function buscarDoTenant(tenantId, id) {
    exigirId(id, 'Cliente não encontrado')
    const contratante = await ContratanteModel.findOne({ _id: id, tenantId })
    if (!contratante) {
        throw new AppError('Cliente não encontrado', 404)
    }
    return contratante
}

// Só servidores e sites da própria conta podem ser ligados ao cliente.
async function filtrarDoTenant(tenantId, dto) {
    if (dto.servidores) {
        dto.servidores = (await ServidorModel.find({ tenantId, _id: { $in: dto.servidores } }, '_id')).map((s) => s._id)
    }
    if (dto.sites) {
        dto.sites = (await SiteModel.find({ tenantId, _id: { $in: dto.sites } }, '_id')).map((s) => s._id)
    }
    return dto
}

function aplicarCobranca(contratante, cobranca) {
    const ligandoAgora = cobranca.ativa && !contratante.cobranca?.ativa
    contratante.cobranca = {
        ...cobranca,
        ativadaEm: ligandoAgora ? new Date() : (cobranca.ativa ? contratante.cobranca?.ativadaEm ?? new Date() : null),
    }
}

async function comResumo(contratantes) {
    const ids = contratantes.map((c) => c._id)
    const ultimas = await FaturaModel.aggregate([
        { $match: { contratanteId: { $in: ids } } },
        { $sort: { vencimento: -1 } },
        { $group: { _id: '$contratanteId', fatura: { $first: '$$ROOT' }, abertas: { $sum: { $cond: [{ $eq: ['$status', 'aberta'] }, 1, 0] } } } },
    ])
    const porId = Object.fromEntries(ultimas.map((u) => [String(u._id), u]))
    return contratantes.map((c) => {
        const u = porId[String(c._id)]
        const f = u?.fatura
        return {
            ...c.toJSON(),
            totalMensal: Math.round((c.cobranca?.itens ?? []).reduce((s, i) => s + i.valor, 0) * 100) / 100,
            ultimaFatura: f ? { _id: f._id, competencia: f.competencia, status: f.status, total: f.total, moeda: f.moeda, vencimento: f.vencimento, vencida: faturaVencida(f) } : null,
            faturasAbertas: u?.abertas ?? 0,
        }
    })
}

export const ContratanteService = {
    async listar(tenantId) {
        const contratantes = await ContratanteModel.find({ tenantId }).sort({ nome: 1 })
        return await comResumo(contratantes)
    },

    async criar(tenantId, body) {
        const dto = ajustarMoeda(await filtrarDoTenant(tenantId, contratanteDTO(body ?? {})), 'BR')
        if (!dto.nome || !dto.email) {
            throw new AppError('Informe o nome e o e-mail do cliente', 400)
        }
        const contratante = new ContratanteModel({ ...dto, cobranca: undefined, tenantId })
        if (dto.cobranca) aplicarCobranca(contratante, dto.cobranca)
        try {
            await contratante.save()
        } catch (error) {
            throw erroDeEmailDuplicado(error)
        }
        return (await comResumo([contratante]))[0]
    },

    async atualizar(tenantId, id, body) {
        const contratante = await buscarDoTenant(tenantId, id)
        const dto = ajustarMoeda(await filtrarDoTenant(tenantId, contratanteDTO(body ?? {})), contratante.pais)
        if ('nome' in dto && !dto.nome) delete dto.nome
        const { cobranca, ...resto } = dto
        Object.assign(contratante, resto)
        if (cobranca) aplicarCobranca(contratante, cobranca)
        // Cliente que passou a ser do Brasil paga pelo Mercado Pago, em reais.
        if (ehBrasil(contratante.pais) && contratante.cobranca) contratante.cobranca.moeda = 'BRL'
        try {
            await contratante.save()
        } catch (error) {
            throw erroDeEmailDuplicado(error)
        }
        return (await comResumo([contratante]))[0]
    },

    async remover(tenantId, id) {
        const contratante = await buscarDoTenant(tenantId, id)
        await FaturaModel.deleteMany({ contratanteId: contratante._id })
        await contratante.deleteOne()
        return null
    },

    // Link para o cliente criar (ou trocar) a senha. O programador copia e manda para ele.
    async gerarLinkDeAcesso(tenantId, id) {
        const contratante = await buscarDoTenant(tenantId, id)
        const token = crypto.randomBytes(24).toString('base64url')
        contratante.conviteHash = hashDoToken(token)
        contratante.conviteExpira = new Date(Date.now() + VALIDADE_DO_LINK_MS)
        await contratante.save()
        // O painel monta o link com o próprio endereço; a url completa fica de reserva.
        return { token, url: urlDoPortal(`/acesso/${token}`), expiraEm: contratante.conviteExpira }
    },

    async listarFaturas(tenantId, id) {
        const contratante = await buscarDoTenant(tenantId, id)
        return await FaturaModel.find({ contratanteId: contratante._id }).sort({ vencimento: -1 }).limit(36)
    },

    async gerarFatura(tenantId, id) {
        const contratante = await buscarDoTenant(tenantId, id)
        return await FaturaService.gerarAgora(contratante)
    },

    // Ações manuais do programador: marcar como paga (recebeu por fora), cancelar ou reabrir.
    async alterarFatura(tenantId, faturaId, acao) {
        exigirId(faturaId, 'Fatura não encontrada')
        const fatura = await FaturaModel.findOne({ _id: faturaId, tenantId })
        if (!fatura) {
            throw new AppError('Fatura não encontrada', 404)
        }
        if (acao === 'paga') {
            if (fatura.status !== 'aberta') throw new AppError('Esta fatura não está em aberto', 409)
            return await FaturaService.marcarPaga(fatura, { gateway: null, id: null, metodo: 'manual' }, { manual: true })
        }
        if (acao === 'cancelar') {
            if (fatura.status !== 'aberta') throw new AppError('Esta fatura não está em aberto', 409)
            fatura.status = 'cancelada'
        } else if (acao === 'reabrir') {
            // Só o que foi marcado à mão volta a ficar em aberto; pagamento real não é desfeito aqui.
            if (fatura.status === 'paga' && !fatura.pagaManual) throw new AppError('Pagamento recebido pelo gateway não pode ser reaberto', 409)
            fatura.status = 'aberta'
            fatura.pagaEm = null
            fatura.pagaManual = false
            fatura.pagamento = { gateway: null, id: null, metodo: null }
        } else {
            throw new AppError('Ação inválida', 400)
        }
        await fatura.save()
        return fatura
    },
}
