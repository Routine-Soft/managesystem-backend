import { PortalController } from './portal.controller.js'
import { authenticateContratante } from './portal.auth.js'

// Portal do cliente final: só leitura dos próprios servidores e sites (com a parte técnica), e pagamento das próprias faturas.
export async function portalRoutes(fastify) {
    // Públicas
    fastify.get('/portal/acesso/:token', PortalController.dadosDoLink)
    fastify.post('/portal/acesso/:token', PortalController.criarSenha)
    fastify.post('/portal/login', PortalController.login)
    fastify.post('/portal/refresh', PortalController.refresh)
    fastify.post('/portal/mercadopago/webhook/:tenantId', PortalController.webhookMercadoPago)

    fastify.register(async function (fastify) {
        fastify.addHook('preHandler', authenticateContratante)

        fastify.get('/portal/resumo', PortalController.resumo)
        fastify.get('/portal/servidores/:id/painel', PortalController.painelDoServidor)
        fastify.patch('/portal/me', PortalController.atualizarMe)
        fastify.post('/portal/me/senha', PortalController.trocarSenha)
        fastify.post('/portal/logout', PortalController.logout)
        fastify.post('/portal/faturas/:id/pagar', PortalController.pagar)
        fastify.post('/portal/faturas/:id/conferir', PortalController.conferirFatura)
        fastify.post('/portal/telegram/vincular', PortalController.linkDoTelegram)
        fastify.post('/portal/telegram/desconectar', PortalController.desconectarTelegram)
    })
}
