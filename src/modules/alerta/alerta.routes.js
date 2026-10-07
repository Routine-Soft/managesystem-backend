import { AlertaController } from './alerta.controller.js'
import { authenticate } from '../shared/middlewares/auth.middleware.js'
import { exigirAssinaturaAtiva } from '../shared/middlewares/assinatura.middleware.js'

export async function alertaRoutes(fastify) {
    fastify.post('/telegram/webhook', AlertaController.webhookTelegram)

    fastify.register(async function (fastify) {
        fastify.addHook('preHandler', authenticate)
        fastify.addHook('preHandler', exigirAssinaturaAtiva)

        fastify.get('/alertas', AlertaController.obter)
        fastify.patch('/alertas', AlertaController.atualizar)
        fastify.post('/alertas/telegram/vincular', AlertaController.vincular)
        fastify.post('/alertas/telegram/desconectar', AlertaController.desconectar)
        fastify.post('/alertas/telegram/testar', AlertaController.testar)
    })
}
