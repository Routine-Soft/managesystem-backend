import 'dotenv/config'
import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import db from './src/db/db.js'
import AppError from './src/errors/AppError.js'
import { idiomaDaRequisicao, traduzir } from './src/modules/shared/utils/idioma.js'
import { userRoutes } from './src/modules/user/user.routes.js'
import { planoRoutes } from './src/modules/plano/plano.routes.js'
import { assinaturaRoutes } from './src/modules/assinatura/assinatura.routes.js'
import { servidorRoutes } from './src/modules/servidor/servidor.routes.js'
import { siteRoutes } from './src/modules/site/site.routes.js'
import { alertaRoutes } from './src/modules/alerta/alerta.routes.js'
import { agenteRoutes } from './src/modules/agente/agente.routes.js'
import { clienteRoutes } from './src/modules/cliente/cliente.routes.js'
import { iniciarMonitor } from './src/modules/monitor/monitor.jobs.js'
import { iniciarBotTelegram } from './src/modules/alerta/telegram.bot.js'

// trustProxy: atrás do Nginx, o IP real do agente vem no X-Forwarded-For.
const fastify = Fastify({ logger: true, trustProxy: true })

await fastify.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
})

// Mensagens da API no idioma de quem pediu (cabeçalho Accept-Language). O código fica em português.
fastify.addHook('preSerialization', async (req, reply, payload) => {
    if (payload && typeof payload.message === 'string') {
        return { ...payload, message: traduzir(payload.message, idiomaDaRequisicao(req)) }
    }
    return payload
})

fastify.setErrorHandler((error, req, reply) => {
    const status = error.statusCode || 500
    if (status >= 500) req.log.error(error)

    // Só as mensagens do AppError são mostradas; erro inesperado não expõe detalhe técnico, e os do próprio
    // Fastify (corpo grande demais, JSON quebrado...) viram uma mensagem simples.
    const mensagem = error instanceof AppError
        ? error.message
        : status >= 500 ? 'Erro interno do servidor' : 'Requisição inválida'

    return reply.status(status).send({
        success: false,
        message: traduzir(mensagem, idiomaDaRequisicao(req), error.params),
        ...(error.codigo ? { code: error.codigo } : {}),
    })
})

fastify.get('/api/saude', async () => ({ success: true, data: { ok: true } }))

await fastify.register(userRoutes, { prefix: '/api' })
await fastify.register(planoRoutes, { prefix: '/api' })
await fastify.register(assinaturaRoutes, { prefix: '/api' })
await fastify.register(servidorRoutes, { prefix: '/api' })
await fastify.register(siteRoutes, { prefix: '/api' })
await fastify.register(alertaRoutes, { prefix: '/api' })
await fastify.register(agenteRoutes, { prefix: '/api' })
await fastify.register(clienteRoutes, { prefix: '/api' })

const start = async () => {
    try {
        await db()
        await fastify.listen({ port: process.env.PORT || 8080, host: '0.0.0.0' })
        iniciarMonitor()
        iniciarBotTelegram()
    } catch (err) {
        fastify.log.error(err)
        process.exit(1)
    }
}

start()
