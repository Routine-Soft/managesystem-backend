import { SiteController } from './site.controller.js'
import { authenticate } from '../shared/middlewares/auth.middleware.js'
import { exigirAssinaturaAtiva } from '../shared/middlewares/assinatura.middleware.js'

export async function siteRoutes(fastify) {
    fastify.register(async function (fastify) {
        fastify.addHook('preHandler', authenticate)
        fastify.addHook('preHandler', exigirAssinaturaAtiva)

        fastify.get('/sites', SiteController.listar)
        fastify.post('/sites', SiteController.criar)
        fastify.patch('/sites/:id', SiteController.atualizar)
        fastify.delete('/sites/:id', SiteController.remover)
        fastify.post('/sites/:id/verificar', SiteController.verificar)
    })
}
