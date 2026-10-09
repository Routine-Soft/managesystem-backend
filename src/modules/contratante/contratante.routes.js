import { ContratanteController } from './contratante.controller.js'
import { authenticate } from '../shared/middlewares/auth.middleware.js'
import { exigirAssinaturaAtiva } from '../shared/middlewares/assinatura.middleware.js'

// Clientes finais do programador e as faturas deles (lado do painel).
export async function contratanteRoutes(fastify) {
    fastify.register(async function (fastify) {
        fastify.addHook('preHandler', authenticate)
        fastify.addHook('preHandler', exigirAssinaturaAtiva)

        fastify.get('/contratantes', ContratanteController.listar)
        fastify.post('/contratantes', ContratanteController.criar)
        fastify.patch('/contratantes/:id', ContratanteController.atualizar)
        fastify.delete('/contratantes/:id', ContratanteController.remover)
        fastify.post('/contratantes/:id/link', ContratanteController.linkDeAcesso)
        fastify.get('/contratantes/:id/faturas', ContratanteController.faturas)
        fastify.post('/contratantes/:id/faturas', ContratanteController.gerarFatura)
        fastify.patch('/faturas/:id', ContratanteController.alterarFatura)
    })
}
