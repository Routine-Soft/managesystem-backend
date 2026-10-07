import { AssinaturaController } from './assinatura.controller.js'
import { authenticate, authorize } from '../shared/middlewares/auth.middleware.js'

export async function assinaturaRoutes(fastify) {

    // Webhooks: quem chama é o Stripe / Mercado Pago (protegidos por assinatura).
    fastify.register(async function (fastify) {
        // O Stripe assina o corpo exatamente como enviou; por isso aqui o JSON não é interpretado.
        fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body))
        fastify.post('/assinaturas/stripe/webhook', AssinaturaController.webhookStripe)
    })
    fastify.post('/assinaturas/mercadopago/webhook', AssinaturaController.webhookMercadoPago)

    fastify.register(async function (fastify) {
        fastify.addHook('preHandler', authenticate)

        fastify.get('/assinaturas/atual', AssinaturaController.getAtual)

        // Pagar e cancelar é com o admin da conta.
        const soAdmin = { preHandler: authorize(['admin', 'super_admin']) }
        fastify.get('/assinaturas/pagamentos', soAdmin, AssinaturaController.pagamentos)
        fastify.post('/assinaturas/stripe/checkout', soAdmin, AssinaturaController.checkoutStripe)
        fastify.post('/assinaturas/stripe/portal', soAdmin, AssinaturaController.portalStripe)
        fastify.post('/assinaturas/stripe/sincronizar', soAdmin, AssinaturaController.sincronizarStripe)
        fastify.post('/assinaturas/pix', soAdmin, AssinaturaController.pix)
        fastify.post('/assinaturas/pix/sincronizar', soAdmin, AssinaturaController.sincronizarPix)
    })
}
