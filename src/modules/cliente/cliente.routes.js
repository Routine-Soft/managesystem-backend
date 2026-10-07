import { ClienteController } from './cliente.controller.js'
import { authenticate, authorize } from '../shared/middlewares/auth.middleware.js'

export async function clienteRoutes(fastify) {
    fastify.register(async function (fastify) {
        fastify.addHook('preHandler', authenticate)
        fastify.addHook('preHandler', authorize(['super_admin']))

        fastify.get('/clientes', ClienteController.listar)
        fastify.get('/clientes/resumo', ClienteController.resumo)
        fastify.patch('/clientes/:id/estender-teste', ClienteController.estenderTeste)
        fastify.patch('/clientes/:id/liberar', ClienteController.liberarManual)
        fastify.patch('/clientes/:id/bloqueio', ClienteController.definirBloqueio)
    })
}
