import { RecebimentoController } from './recebimento.controller.js'
import { authenticate, authorize } from '../shared/middlewares/auth.middleware.js'
import { exigirAssinaturaAtiva } from '../shared/middlewares/assinatura.middleware.js'

// Onde o programador recebe dos clientes dele. Só o admin da conta mexe nas chaves.
export async function recebimentoRoutes(fastify) {
    fastify.register(async function (fastify) {
        fastify.addHook('preHandler', authenticate)
        fastify.addHook('preHandler', exigirAssinaturaAtiva)
        fastify.addHook('preHandler', authorize(['admin', 'super_admin']))

        fastify.get('/recebimentos', RecebimentoController.obter)
        fastify.post('/recebimentos/mercadopago', RecebimentoController.conectarMercadoPago)
        fastify.post('/recebimentos/stripe', RecebimentoController.conectarStripe)
        fastify.delete('/recebimentos/:gateway', RecebimentoController.desconectar)
    })
}
