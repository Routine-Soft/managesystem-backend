import { ClienteService } from './cliente.service.js'

export const ClienteController = {
    async listar(req, reply) {
        return reply.send({ success: true, data: await ClienteService.listar() })
    },

    async resumo(req, reply) {
        return reply.send({ success: true, data: await ClienteService.resumo() })
    },

    async criar(req, reply) {
        const data = await ClienteService.criar(req.body)
        return reply.code(201).send({ success: true, data, message: 'Assinante cadastrado' })
    },

    async editar(req, reply) {
        await ClienteService.editar(req.params.id, req.body)
        return reply.send({ success: true, data: null, message: 'Assinante atualizado' })
    },

    async excluir(req, reply) {
        await ClienteService.excluir(req.params.id)
        return reply.send({ success: true, data: null, message: 'Assinante excluído' })
    },

    async redefinirSenha(req, reply) {
        await ClienteService.redefinirSenha(req.params.id, req.body?.novaSenha)
        return reply.send({ success: true, data: null, message: 'Senha redefinida' })
    },

    async pagamentos(req, reply) {
        return reply.send({ success: true, data: await ClienteService.pagamentos(req.params.id) })
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
