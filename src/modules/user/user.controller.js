import { UserService } from './user.service.js'

export const UserController = {
    async registrar(req, reply) {
        const sessao = await UserService.registrar(req.body)
        return reply.code(201).send({ success: true, data: sessao, message: 'Conta criada com sucesso' })
    },

    async login(req, reply) {
        const sessao = await UserService.login(req.body)
        return reply.send({ success: true, data: sessao, message: 'Login realizado com sucesso' })
    },

    async refresh(req, reply) {
        const result = await UserService.refresh(req.body?.refreshToken)
        return reply.send({ success: true, data: result, message: 'Token renovado' })
    },

    async logout(req, reply) {
        await UserService.logout(req.user.id)
        return reply.send({ success: true, data: null, message: 'Você saiu da conta' })
    },

    async getMe(req, reply) {
        const user = await UserService.findMe(req.user.id)
        return reply.send({ success: true, data: user })
    },

    async updateMe(req, reply) {
        const { id, tenantId, role } = req.user
        const user = await UserService.updateMe(id, tenantId, role, req.body)
        return reply.send({ success: true, data: user, message: 'Dados atualizados com sucesso' })
    },

    async updateMyPassword(req, reply) {
        await UserService.updateMyPassword(req.user.id, req.body)
        return reply.send({ success: true, data: null, message: 'Senha alterada com sucesso' })
    },

    async listarEquipe(req, reply) {
        const users = await UserService.listarEquipe(req.user.tenantId)
        return reply.send({ success: true, data: users })
    },

    async criarMembro(req, reply) {
        const user = await UserService.criarMembro(req.user.tenantId, req.body)
        return reply.code(201).send({ success: true, data: user, message: 'Usuário criado com sucesso' })
    },

    async atualizarMembro(req, reply) {
        const user = await UserService.atualizarMembro(req.user.tenantId, req.params.id, req.body)
        return reply.send({ success: true, data: user, message: 'Usuário atualizado com sucesso' })
    },

    async redefinirSenhaMembro(req, reply) {
        await UserService.redefinirSenhaMembro(req.user.tenantId, req.params.id, req.body?.novaSenha)
        return reply.send({ success: true, data: null, message: 'Senha redefinida com sucesso' })
    },

    async removerMembro(req, reply) {
        await UserService.removerMembro(req.user.tenantId, req.params.id, req.user.id)
        return reply.send({ success: true, data: null, message: 'Usuário removido com sucesso' })
    },
}
