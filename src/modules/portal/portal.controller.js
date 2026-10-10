import { PortalService } from './portal.service.js'
import { FaturaService } from '../contratante/fatura.service.js'

export const PortalController = {
    async dadosDoLink(req, reply) {
        const dados = await PortalService.dadosDoLink(req.params.token)
        return reply.send({ success: true, data: dados })
    },

    async criarSenha(req, reply) {
        const sessao = await PortalService.criarSenha(req.params.token, req.body?.password)
        return reply.send({ success: true, data: sessao, message: 'Senha criada com sucesso' })
    },

    async login(req, reply) {
        const sessao = await PortalService.login(req.body)
        return reply.send({ success: true, data: sessao })
    },

    async refresh(req, reply) {
        const result = await PortalService.refresh(req.body?.refreshToken)
        return reply.send({ success: true, data: result })
    },

    async logout(req, reply) {
        await PortalService.logout(req.contratante.id)
        return reply.send({ success: true, data: null })
    },

    async atualizarMe(req, reply) {
        const contratante = await PortalService.atualizarMe(req.contratante.id, req.body)
        return reply.send({ success: true, data: contratante })
    },

    async trocarSenha(req, reply) {
        await PortalService.trocarSenha(req.contratante.id, req.body)
        return reply.send({ success: true, data: null, message: 'Senha alterada com sucesso' })
    },

    async resumo(req, reply) {
        const dados = await PortalService.resumo(req.contratante.id, req.query?.tz)
        return reply.send({ success: true, data: dados })
    },

    async painelDoServidor(req, reply) {
        const dados = await PortalService.painelDoServidor(req.contratante.id, req.params.id, req.query)
        return reply.send({ success: true, data: dados })
    },

    async pagar(req, reply) {
        const result = await PortalService.pagar(req.contratante.id, req.params.id)
        return reply.send({ success: true, data: result, message: 'Abrindo o pagamento' })
    },

    async conferirFatura(req, reply) {
        const fatura = await PortalService.conferirFatura(req.contratante.id, req.params.id)
        return reply.send({ success: true, data: fatura })
    },

    async linkDoTelegram(req, reply) {
        const result = await PortalService.linkDoTelegram(req.contratante.id)
        return reply.send({ success: true, data: result })
    },

    async desconectarTelegram(req, reply) {
        await PortalService.desconectarTelegram(req.contratante.id)
        return reply.send({ success: true, data: null, message: 'Telegram desconectado' })
    },

    // Aviso do Mercado Pago sobre pagamento de fatura. Não precisa de assinatura: a situação é sempre
    // consultada de novo no Mercado Pago com a chave do programador, e só vale se bater com a fatura.
    async webhookMercadoPago(req, reply) {
        const tipo = req.body?.type ?? req.query?.type ?? req.query?.topic
        const paymentId = req.query?.['data.id'] ?? req.body?.data?.id ?? (tipo === 'payment' ? req.query?.id : null)
        if (tipo === 'payment' && /^[a-f0-9]{24}$/.test(req.params.tenantId) && /^\d+$/.test(String(paymentId ?? ''))) {
            await FaturaService.webhookMercadoPago(req.params.tenantId, String(paymentId)).catch((error) => req.log.error(error))
        }
        return reply.send({ received: true })
    },
}
