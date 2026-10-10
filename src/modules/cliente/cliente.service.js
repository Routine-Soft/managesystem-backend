import UserModel from '../user/user.model.js'
import AssinaturaModel from '../assinatura/assinatura.model.js'
import PagamentoModel from '../assinatura/pagamento.model.js'
import ServidorModel from '../servidor/servidor.model.js'
import SiteModel from '../site/site.model.js'
import PlanoModel from '../plano/plano.model.js'
import mongoose from 'mongoose'
import argon2 from 'argon2'
import MetricaModel from '../servidor/metrica.model.js'
import VerificacaoModel from '../servidor/verificacao.model.js'
import IncidenteModel from '../servidor/incidente.model.js'
import EventoModel from '../servidor/evento.model.js'
import ContratanteModel from '../contratante/contratante.model.js'
import FaturaModel from '../contratante/fatura.model.js'
import RecebimentoModel from '../recebimento/recebimento.model.js'
import AlertaConfigModel from '../alerta/alerta.model.js'
import { AssinaturaService } from '../assinatura/assinatura.service.js'
import { criarConta, validarEmail, validarSenha, erroDeEmailDuplicado } from '../user/user.service.js'
import { normalizarEmail } from '../user/user.dto.js'
import { paisValido } from '../shared/utils/pais.js'
import { avaliarAcesso, DIA_EM_MS } from '../assinatura/assinatura.acesso.js'
import AppError from '../../errors/AppError.js'
import { exigirId } from '../shared/utils/ids.js'

// Painel do super_admin: as contas (cada dono "admin" é um cliente), suas assinaturas e a receita.

async function donoDaConta(tenantId) {
    exigirId(tenantId, 'Cliente não encontrado')
    const dono = await UserModel.findOne({ _id: tenantId, role: 'admin', $expr: { $eq: ['$_id', '$tenantId'] } })
    if (!dono) {
        throw new AppError('Cliente não encontrado', 404)
    }
    return dono
}

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

        const contar = (Model) => Model.aggregate([{ $match: { tenantId: { $in: ids } } }, { $group: { _id: '$tenantId', total: { $sum: 1 } } }])
        const [assinaturas, servidores, sites, contratantes, usuarios, pagos] = await Promise.all([
            AssinaturaModel.find({ tenantId: { $in: ids } }).sort({ createdAt: -1 }).populate('planoId', 'nome tipo precoUSD'),
            contar(ServidorModel),
            contar(SiteModel),
            contar(ContratanteModel),
            contar(UserModel),
            PagamentoModel.aggregate([
                { $match: { tenantId: { $in: ids }, status: 'aprovado' } },
                { $group: { _id: { tenantId: '$tenantId', moeda: '$moeda' }, total: { $sum: '$valor' }, quantidade: { $sum: 1 } } },
            ]),
        ])
        const mapa = (lista) => new Map(lista.map((x) => [String(x._id), x.total]))
        const contratantesPor = mapa(contratantes)
        const usuariosPor = mapa(usuarios)
        const pagosPor = new Map()
        for (const p of pagos) {
            const chave = String(p._id.tenantId)
            pagosPor.set(chave, [...(pagosPor.get(chave) ?? []), { moeda: p._id.moeda, total: p.total, quantidade: p.quantidade }])
        }

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
                pais: dono.pais,
                criadoEm: dono.createdAt,
                servidores: servidoresPor.get(String(dono._id)) ?? 0,
                sites: sitesPor.get(String(dono._id)) ?? 0,
                contratantes: contratantesPor.get(String(dono._id)) ?? 0,
                usuarios: usuariosPor.get(String(dono._id)) ?? 0,
                pago: pagosPor.get(String(dono._id)) ?? [],
                assinatura: assinatura && {
                    status: assinatura.status,
                    cobranca: assinatura.cobranca,
                    plano: assinatura.planoId?.nome ?? null,
                    planoId: assinatura.planoId?._id ?? null,
                    planoTipo: assinatura.planoId?.tipo ?? null,
                    precoUSD: assinatura.planoId?.precoUSD ?? null,
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

    // Trocar plano por fora do gateway: plano pago fica ativo sem cobrança até a data (cortesia, pagamento por fora);
    // plano grátis volta ao teste até a data.
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
        assinatura.inadimplenteDesde = null
        if (plano.tipo === 'gratis') {
            // Plano grátis: volta ao período de teste até a data escolhida.
            assinatura.status = 'trial'
            assinatura.dataFimTrial = fim
            assinatura.proximaCobranca = null
        } else {
            assinatura.status = 'ativa'
            assinatura.cobranca = 'manual'
            assinatura.proximaCobranca = fim
        }
        await assinatura.save()
        return assinatura
    },

    // ----- Cadastro feito pelo super_admin -----

    async criar(body) {
        const dono = await criarConta(body)
        return { id: dono._id }
    },

    async editar(tenantId, body) {
        const dono = await donoDaConta(tenantId)
        const b = body ?? {}
        const dto = {}
        if ('nomeCompleto' in b && String(b.nomeCompleto).trim()) dto.nomeCompleto = String(b.nomeCompleto).trim()
        if ('telefone' in b) dto.telefone = String(b.telefone ?? '').trim() || null
        if ('email' in b) {
            dto.email = normalizarEmail(b.email)
            validarEmail(dto.email)
        }
        // Empresa e país valem para a equipe inteira da conta.
        const daConta = {}
        if ('nomeEmpresa' in b && String(b.nomeEmpresa).trim()) daConta.nomeEmpresa = String(b.nomeEmpresa).trim()
        if ('pais' in b && paisValido(b.pais)) daConta.pais = paisValido(b.pais)
        try {
            await UserModel.updateOne({ _id: dono._id }, { $set: { ...dto, ...daConta } }, { runValidators: true })
        } catch (error) {
            throw erroDeEmailDuplicado(error)
        }
        if (Object.keys(daConta).length) await UserModel.updateMany({ tenantId: dono._id }, { $set: daConta })
        return null
    },

    // Senha nova para o dono da conta que esqueceu a dele. As sessões abertas caem.
    async redefinirSenha(tenantId, novaSenha) {
        const dono = await donoDaConta(tenantId)
        validarSenha(novaSenha)
        dono.password = await argon2.hash(String(novaSenha))
        dono.tokenRefresh = null
        await dono.save()
        return null
    },

    async pagamentos(tenantId) {
        exigirId(tenantId, 'Cliente não encontrado')
        const lista = await PagamentoModel.find({ tenantId, status: 'aprovado' }).sort({ aprovadoEm: -1 }).limit(100).populate('planoId', 'nome')
        return lista.map((p) => ({ _id: p._id, aprovadoEm: p.aprovadoEm, valor: p.valor, moeda: p.moeda, metodo: p.metodo, plano: p.planoId?.nome ?? null }))
    },

    // Apaga a conta inteira: para a cobrança no cartão e remove usuários, servidores (e o histórico deles), sites,
    // clientes finais, faturas e configurações. Os pagamentos ficam guardados (histórico da receita).
    async excluir(tenantId) {
        const dono = await donoDaConta(tenantId)
        const tid = new mongoose.Types.ObjectId(String(dono._id))
        await AssinaturaService.encerrarCobrancasDoTenant(tid)
        const servidores = (await ServidorModel.find({ tenantId: tid }, '_id')).map((s) => s._id)
        await Promise.all([
            MetricaModel.deleteMany({ servidorId: { $in: servidores } }),
            VerificacaoModel.deleteMany({ servidorId: { $in: servidores } }),
            IncidenteModel.deleteMany({ servidorId: { $in: servidores } }),
            EventoModel.deleteMany({ servidorId: { $in: servidores } }),
        ])
        await Promise.all([
            ServidorModel.deleteMany({ tenantId: tid }),
            SiteModel.deleteMany({ tenantId: tid }),
            ContratanteModel.deleteMany({ tenantId: tid }),
            FaturaModel.deleteMany({ tenantId: tid }),
            RecebimentoModel.deleteMany({ tenantId: tid }),
            AlertaConfigModel.deleteMany({ tenantId: tid }),
            AssinaturaModel.deleteMany({ tenantId: tid }),
        ])
        await UserModel.deleteMany({ tenantId: tid })
        return null
    },

    async definirBloqueio(tenantId, bloqueado) {
        const assinatura = await assinaturaDoCliente(tenantId)
        assinatura.acessoRevogado = !!bloqueado
        await assinatura.save()
        return assinatura
    },
}
