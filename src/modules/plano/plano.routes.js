import { PlanoController } from './plano.controller.js'
import { authenticate, authorize } from '../shared/middlewares/auth.middleware.js'

export async function planoRoutes(fastify) {
    // Pública: a página inicial mostra os planos para quem ainda não tem conta.
    fastify.get('/planos/publicos', PlanoController.publicos)

    fastify.register(async function (fastify) {
        fastify.addHook('preHandler', authenticate)

        const soSuperAdmin = { preHandler: authorize(['super_admin']) }
        fastify.get('/planos', PlanoController.listar)
        fastify.post('/planos', soSuperAdmin, PlanoController.criar)
        fastify.patch('/planos/:id', soSuperAdmin, PlanoController.atualizar)
        fastify.delete('/planos/:id', soSuperAdmin, PlanoController.remover)
    })
}
