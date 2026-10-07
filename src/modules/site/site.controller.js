import { SiteService } from './site.service.js'

export const SiteController = {
    async listar(req, reply) {
        const sites = await SiteService.listar(req.user.tenantId)
        return reply.send({ success: true, data: sites })
    },

    async criar(req, reply) {
        const site = await SiteService.criar(req.user.tenantId, req.body)
        return reply.code(201).send({ success: true, data: site, message: 'Site adicionado com sucesso' })
    },

    async atualizar(req, reply) {
        const site = await SiteService.atualizar(req.user.tenantId, req.params.id, req.body)
        return reply.send({ success: true, data: site, message: 'Site atualizado com sucesso' })
    },

    async remover(req, reply) {
        await SiteService.remover(req.user.tenantId, req.params.id)
        return reply.send({ success: true, data: null, message: 'Site removido com sucesso' })
    },

    async verificar(req, reply) {
        const site = await SiteService.verificarAgora(req.user.tenantId, req.params.id)
        return reply.send({ success: true, data: site, message: 'Dados do domínio atualizados' })
    },
}
