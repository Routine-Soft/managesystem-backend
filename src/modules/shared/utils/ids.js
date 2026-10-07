import mongoose from 'mongoose'
import AppError from '../../../errors/AppError.js'

// Id inválido vira 404 (e não um erro 500 do Mongoose).
export function exigirId(id, mensagem = 'Registro não encontrado') {
    if (!mongoose.isValidObjectId(id)) {
        throw new AppError(mensagem, 404)
    }
    return id
}
