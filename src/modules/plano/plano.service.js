import PlanoModel from './plano.model.js'
import AssinaturaModel from '../assinatura/assinatura.model.js'
import { planoDTO } from './plano.dto.js'
import AppError from '../../errors/AppError.js'
import { exigirId } from '../shared/utils/ids.js'

export const PlanoService = {
    // Clientes veem só os planos ativos; o super_admin vê todos.
    async listar(role) {
        const filtro = role === 'super_admin' ? {} : { ativo: true }
        return await PlanoModel.find(filtro).sort({ tipo: 1, precoBRL: 1 })
    },

    async criar(body) {
        const dto = planoDTO(body)
        if (!dto.nome || !dto.tipo) {
            throw new AppError('Informe o nome e o tipo do plano', 400)
        }
        return await PlanoModel.create(dto)
    },

    async atualizar(id, body) {
        exigirId(id, 'Plano não encontrado')
        const dto = planoDTO(body)
        if ('nome' in dto && !dto.nome) delete dto.nome
        const plano = await PlanoModel.findByIdAndUpdate(id, { $set: dto }, { new: true, runValidators: true })
        if (!plano) {
            throw new AppError('Plano não encontrado', 404)
        }
        return plano
    },

    // Plano em uso não é apagado: desative-o para ninguém mais assinar.
    async remover(id) {
        exigirId(id, 'Plano não encontrado')
        if (await AssinaturaModel.exists({ planoId: id })) {
            throw new AppError('Este plano está em uso por algum cliente. Desative-o em vez de excluir.', 409)
        }
        const plano = await PlanoModel.findByIdAndDelete(id)
        if (!plano) {
            throw new AppError('Plano não encontrado', 404)
        }
        return null
    },
}
