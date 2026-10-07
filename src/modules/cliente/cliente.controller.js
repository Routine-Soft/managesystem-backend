import { ClienteService } from './cliente.service.js'

export const ClienteController = {
    async listar(req, reply) {
        return reply.send({ success: true, data: await ClienteService.listar() })
    },

    async resumo(req, reply) {
        return reply.send({ success: true, data: await ClienteService.resumo() })
    },

    async estenderTeste(req, reply) {
        await ClienteService.estenderTeste(req.params.id, req.body?.dias)
        return reply.send({ success: true, data: null, message: 'Teste estendido' })
    },

    async liberarManual(req, reply) {
        await ClienteService.liberarManual(req.params.id, req.body?.planoId, req.body?.ate)
        return reply.send({ success: true, data: null, message: 'Acesso liberado' })
    },

    async definirBloqueio(req, reply) {
        const bloqueado = !!req.body?.bloqueado
        await ClienteService.definirBloqueio(req.params.id, bloqueado)
        return reply.send({ success: true, data: null, message: bloqueado ? 'Acesso bloqueado' : 'Acesso desbloqueado' })
    },
}
