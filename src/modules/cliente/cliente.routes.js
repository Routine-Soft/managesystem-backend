import { ClienteController } from './cliente.controller.js'
import { authenticate, authorize } from '../shared/middlewares/auth.middleware.js'

export async function clienteRoutes(fastify) {
    fastify.register(async function (fastify) {
        fastify.addHook('preHandler', authenticate)
        fastify.addHook('preHandler', authorize(['super_admin']))

        fastify.get('/clientes', ClienteController.listar)
        fastify.get('/clientes/resumo', ClienteController.resumo)
        fastify.post('/clientes', ClienteController.criar)
        fastify.patch('/clientes/:id', ClienteController.editar)
        fastify.delete('/clientes/:id', ClienteController.excluir)
        fastify.patch('/clientes/:id/senha', ClienteController.redefinirSenha)
        fastify.get('/clientes/:id/pagamentos', ClienteController.pagamentos)
        fastify.patch('/clientes/:id/estender-teste', ClienteController.estenderTeste)
        fastify.patch('/clientes/:id/liberar', ClienteController.liberarManual)
        fastify.patch('/clientes/:id/bloqueio', ClienteController.definirBloqueio)
    })
}
