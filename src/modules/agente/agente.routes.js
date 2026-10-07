import { AgenteController } from './agente.controller.js'

// Rotas usadas pelo agente instalado no servidor do cliente. A autenticação é pelo token do servidor
// (cabeçalho Authorization), conferida dentro do controller.
export async function agenteRoutes(fastify) {
    fastify.get('/agente/install.sh', AgenteController.instalador)
    fastify.get('/agente/agent.mjs', AgenteController.codigo)
    fastify.get('/agente/versao', AgenteController.versao)

    fastify.post('/agente/coleta', { bodyLimit: 512 * 1024 }, AgenteController.coleta)
    fastify.post('/agente/inventario', { bodyLimit: 4 * 1024 * 1024 }, AgenteController.inventario)
}
