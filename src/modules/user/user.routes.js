import { UserController } from './user.controller.js'
import { authenticate, authorize } from '../shared/middlewares/auth.middleware.js'

export async function userRoutes(fastify) {

    // rotas públicas
    fastify.post('/users/registro', UserController.registrar)
    fastify.post('/users/login', UserController.login)
    fastify.post('/users/refresh', UserController.refresh)

    fastify.register(async function (fastify) {
        fastify.addHook('preHandler', authenticate)

        fastify.get('/users/me', UserController.getMe)
        fastify.patch('/users/me', UserController.updateMe)
        fastify.post('/users/me/senha', UserController.updateMyPassword)
        fastify.post('/users/logout', UserController.logout)

        // Equipe: só o admin da conta cadastra e altera usuários.
        const soAdmin = { preHandler: authorize(['admin', 'super_admin']) }
        fastify.get('/users/equipe', UserController.listarEquipe)
        fastify.post('/users/equipe', soAdmin, UserController.criarMembro)
        fastify.patch('/users/equipe/:id', soAdmin, UserController.atualizarMembro)
        fastify.patch('/users/equipe/:id/senha', soAdmin, UserController.redefinirSenhaMembro)
        fastify.delete('/users/equipe/:id', soAdmin, UserController.removerMembro)
    })
}
