import { ServidorService } from './servidor.service.js'

export const ServidorController = {
    async resumo(req, reply) {
        const resumo = await ServidorService.resumoGeral(req.user.tenantId)
        return reply.send({ success: true, data: resumo })
    },

    async listar(req, reply) {
        const servidores = await ServidorService.listar(req.user.tenantId)
        return reply.send({ success: true, data: servidores })
    },

    async criar(req, reply) {
        const result = await ServidorService.criar(req.user.tenantId, req.body)
        return reply.code(201).send({ success: true, data: result, message: 'Servidor adicionado. Agora instale o agente.' })
    },

    async painel(req, reply) {
        const painel = await ServidorService.painel(req.user.tenantId, req.params.id, req.query ?? {})
        return reply.send({ success: true, data: painel })
    },

    async atualizar(req, reply) {
        const servidor = await ServidorService.atualizar(req.user.tenantId, req.params.id, req.body)
        return reply.send({ success: true, data: servidor, message: 'Servidor atualizado com sucesso' })
    },

    async remover(req, reply) {
        await ServidorService.remover(req.user.tenantId, req.params.id)
        return reply.send({ success: true, data: null, message: 'Servidor removido com sucesso' })
    },

    async novoComando(req, reply) {
        const result = await ServidorService.novoComando(req.user.tenantId, req.params.id)
        return reply.send({ success: true, data: result, message: 'Novo comando gerado. O comando antigo deixou de funcionar.' })
    },

    async verificarAgora(req, reply) {
        await ServidorService.verificarAgora(req.user.tenantId, req.params.id)
        return reply.send({ success: true, data: null, message: 'Pedido enviado. O agente atualiza os dados em até 1 minuto.' })
    },
}
