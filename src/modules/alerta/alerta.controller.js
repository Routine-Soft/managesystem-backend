import crypto from 'node:crypto'
import { AlertaService } from './alerta.service.js'

function segredoValido(recebido) {
    const esperado = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!esperado || !recebido) return false
    const a = Buffer.from(String(recebido))
    const b = Buffer.from(esperado)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export const AlertaController = {
    async obter(req, reply) {
        const config = await AlertaService.obterParaTela(req.user.tenantId)
        return reply.send({ success: true, data: config })
    },

    async atualizar(req, reply) {
        const config = await AlertaService.atualizar(req.user.tenantId, req.body)
        return reply.send({ success: true, data: config, message: 'Alertas salvos' })
    },

    async vincular(req, reply) {
        const result = await AlertaService.gerarLinkDeVinculo(req.user.tenantId)
        return reply.send({ success: true, data: result })
    },

    async desconectar(req, reply) {
        const config = await AlertaService.desconectar(req.user.tenantId)
        return reply.send({ success: true, data: config, message: 'Telegram desconectado' })
    },

    async testar(req, reply) {
        await AlertaService.testar(req.user.tenantId)
        return reply.send({ success: true, data: null, message: 'Mensagem de teste enviada' })
    },

    // Quem chama é o Telegram; o cabeçalho secreto prova que a chamada veio dele.
    async webhookTelegram(req, reply) {
        if (!segredoValido(req.headers['x-telegram-bot-api-secret-token'])) {
            return reply.code(401).send({ success: false, message: 'Webhook inválido' })
        }
        await AlertaService.processarMensagemDoBot(req.body?.message).catch((error) => req.log.error(error))
        return reply.send({ ok: true })
    },
}
