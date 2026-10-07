import { ServidorController } from './servidor.controller.js'
import { authenticate } from '../shared/middlewares/auth.middleware.js'
import { exigirAssinaturaAtiva } from '../shared/middlewares/assinatura.middleware.js'

export async function servidorRoutes(fastify) {
    fastify.register(async function (fastify) {
        fastify.addHook('preHandler', authenticate)
        fastify.addHook('preHandler', exigirAssinaturaAtiva)

        fastify.get('/resumo', ServidorController.resumo)
        fastify.get('/servidores', ServidorController.listar)
        fastify.post('/servidores', ServidorController.criar)
        fastify.get('/servidores/:id/painel', ServidorController.painel)
        fastify.patch('/servidores/:id', ServidorController.atualizar)
        fastify.delete('/servidores/:id', ServidorController.remover)
        fastify.post('/servidores/:id/comando', ServidorController.novoComando)
        fastify.post('/servidores/:id/verificar', ServidorController.verificarAgora)
    })
}
