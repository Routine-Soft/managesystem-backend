import { ContratanteService } from './contratante.service.js'

export const ContratanteController = {
    async listar(req, reply) {
        const contratantes = await ContratanteService.listar(req.user.tenantId)
        return reply.send({ success: true, data: contratantes })
    },

    async criar(req, reply) {
        const contratante = await ContratanteService.criar(req.user.tenantId, req.body)
        return reply.code(201).send({ success: true, data: contratante, message: 'Cliente cadastrado' })
    },

    async atualizar(req, reply) {
        const contratante = await ContratanteService.atualizar(req.user.tenantId, req.params.id, req.body)
        return reply.send({ success: true, data: contratante, message: 'Cliente atualizado' })
    },

    async remover(req, reply) {
        await ContratanteService.remover(req.user.tenantId, req.params.id)
        return reply.send({ success: true, data: null, message: 'Cliente removido' })
    },

    async linkDeAcesso(req, reply) {
        const result = await ContratanteService.gerarLinkDeAcesso(req.user.tenantId, req.params.id)
        return reply.send({ success: true, data: result })
    },

    async faturas(req, reply) {
        const faturas = await ContratanteService.listarFaturas(req.user.tenantId, req.params.id)
        return reply.send({ success: true, data: faturas })
    },

    async gerarFatura(req, reply) {
        const fatura = await ContratanteService.gerarFatura(req.user.tenantId, req.params.id)
        return reply.code(201).send({ success: true, data: fatura, message: 'Fatura gerada' })
    },

    async alterarFatura(req, reply) {
        const fatura = await ContratanteService.alterarFatura(req.user.tenantId, req.params.id, req.body?.acao)
        return reply.send({ success: true, data: fatura, message: 'Fatura atualizada' })
    },
}
