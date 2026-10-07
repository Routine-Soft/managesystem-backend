import { PlanoService } from './plano.service.js'

export const PlanoController = {
    async listar(req, reply) {
        const planos = await PlanoService.listar(req.user.role)
        return reply.send({ success: true, data: planos })
    },

    async criar(req, reply) {
        const plano = await PlanoService.criar(req.body)
        return reply.code(201).send({ success: true, data: plano, message: 'Plano criado com sucesso' })
    },

    async atualizar(req, reply) {
        const plano = await PlanoService.atualizar(req.params.id, req.body)
        return reply.send({ success: true, data: plano, message: 'Plano atualizado com sucesso' })
    },

    async remover(req, reply) {
        await PlanoService.remover(req.params.id)
        return reply.send({ success: true, data: null, message: 'Plano removido com sucesso' })
    },
}
