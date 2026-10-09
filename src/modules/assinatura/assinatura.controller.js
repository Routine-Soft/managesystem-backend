import crypto from 'node:crypto'
import { AssinaturaService } from './assinatura.service.js'
import { avaliarAcesso } from './assinatura.acesso.js'
import { getStripe } from '../../config/stripe.js'
import { stripeConfigurado } from '../../config/stripe.js'
import { mercadoPagoConfigurado } from '../../config/mercadopago.js'
import UserModel from '../user/user.model.js'
import { ehBrasil } from '../shared/utils/pais.js'
import { cotacaoDoDolar } from '../shared/utils/cambio.js'

// Confere a assinatura que o Mercado Pago envia no cabeçalho x-signature (HMAC-SHA256 do "manifest").
function assinaturaMercadoPagoValida(req, dataId) {
    const xSignature = req.headers['x-signature']
    const xRequestId = req.headers['x-request-id']
    if (!xSignature) return false

    const partes = Object.fromEntries(
        xSignature.split(',').map((p) => p.trim().split('=').map((s) => s.trim()))
    )
    if (!partes.ts || !partes.v1) return false

    const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId};ts:${partes.ts};`
    const esperado = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update(manifest).digest('hex')

    const a = Buffer.from(esperado)
    const b = Buffer.from(partes.v1)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// A assinatura sempre vai com o estado de acesso e as formas de pagamento disponíveis.
// Conta do Brasil vê só o Pix (Mercado Pago, com a cotação do dólar); de fora, só o cartão (Stripe).
async function comAcesso(assinatura) {
    const dono = await UserModel.findById(assinatura.tenantId, 'pais')
    const brasil = ehBrasil(dono?.pais ?? 'BR')
    return {
        ...assinatura.toJSON(),
        acesso: avaliarAcesso(assinatura),
        formasDePagamento: {
            pais: dono?.pais ?? 'BR',
            cartao: !brasil && stripeConfigurado(),
            pix: brasil && mercadoPagoConfigurado(),
            cotacaoUSD: brasil ? await cotacaoDoDolar().catch(() => null) : null,
        },
    }
}

async function idiomaDoUsuario(id) {
    const user = await UserModel.findById(id, 'idioma')
    return user?.idioma ?? 'pt'
}

export const AssinaturaController = {
    async getAtual(req, reply) {
        const { tenantId } = req.user
        await AssinaturaService.confirmarPixPendente(tenantId).catch(() => null)
        const assinatura = await AssinaturaService.obterAssinaturaAtual(tenantId)
        return reply.send({ success: true, data: await comAcesso(assinatura) })
    },

    async pagamentos(req, reply) {
        const pagamentos = await AssinaturaService.historicoDePagamentos(req.user.tenantId)
        return reply.send({ success: true, data: pagamentos })
    },

    async checkoutStripe(req, reply) {
        const idioma = await idiomaDoUsuario(req.user.id)
        const result = await AssinaturaService.iniciarCheckoutStripe(req.user.tenantId, req.body?.planoId, idioma)
        return reply.send({ success: true, data: result, message: 'Abrindo o pagamento' })
    },

    async portalStripe(req, reply) {
        const idioma = await idiomaDoUsuario(req.user.id)
        const result = await AssinaturaService.abrirPortalStripe(req.user.tenantId, idioma)
        return reply.send({ success: true, data: result })
    },

    async sincronizarStripe(req, reply) {
        const assinatura = await AssinaturaService.sincronizarStripe(req.user.tenantId, req.body?.sessionId)
        return reply.send({ success: true, data: await comAcesso(assinatura), message: 'Assinatura atualizada' })
    },

    async pix(req, reply) {
        const { planoId, documento } = req.body ?? {}
        const pagamento = await AssinaturaService.iniciarPagamentoPix(req.user.tenantId, planoId, documento)
        return reply.send({ success: true, data: pagamento, message: 'Pix gerado com sucesso' })
    },

    async sincronizarPix(req, reply) {
        const { pagamento, assinatura } = await AssinaturaService.sincronizarPix(req.user.tenantId)
        return reply.send({ success: true, data: { pagamento, assinatura: await comAcesso(assinatura) } })
    },

    // Quem chama é o Stripe. O corpo chega cru (Buffer) para a assinatura do webhook poder ser conferida.
    async webhookStripe(req, reply) {
        let evento
        try {
            evento = getStripe().webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
        } catch {
            return reply.code(400).send({ success: false, message: 'Webhook inválido' })
        }
        await AssinaturaService.processarEventoStripe(evento)
        return reply.send({ received: true })
    },

    async webhookMercadoPago(req, reply) {
        const dataId = req.query['data.id'] || req.body?.data?.id

        // Com o segredo configurado, toda chamada precisa vir assinada.
        if (process.env.MP_WEBHOOK_SECRET && !assinaturaMercadoPagoValida(req, dataId)) {
            return reply.code(401).send({ success: false, message: 'Webhook inválido' })
        }

        const type = req.body?.type ?? req.query.type
        if (type === 'payment' && dataId) {
            await AssinaturaService.processarWebhookMercadoPago(dataId)
        }
        return reply.send({ received: true })
    },
}
