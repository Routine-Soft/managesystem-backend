import { RecebimentoService } from './recebimento.service.js'

export const RecebimentoController = {
    async obter(req, reply) {
        const recebimento = await RecebimentoService.obter(req.user.tenantId)
        return reply.send({ success: true, data: recebimento })
    },

    async conectarMercadoPago(req, reply) {
        const recebimento = await RecebimentoService.conectarMercadoPago(req.user.tenantId, req.body?.accessToken)
        return reply.send({ success: true, data: recebimento, message: 'Mercado Pago conectado' })
    },

    async conectarStripe(req, reply) {
        const recebimento = await RecebimentoService.conectarStripe(req.user.tenantId, req.body?.chave)
        return reply.send({ success: true, data: recebimento, message: 'Stripe conectado' })
    },

    async desconectar(req, reply) {
        const recebimento = await RecebimentoService.desconectar(req.user.tenantId, req.params.gateway)
        return reply.send({ success: true, data: recebimento, message: 'Conta desconectada' })
    },
}
