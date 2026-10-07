import jwt from 'jsonwebtoken'
import AppError from '../../../errors/AppError.js'
import UserModel from '../../user/user.model.js'

export async function authenticate(req) {
    const authHeader = req.headers.authorization

    if (!authHeader) {
        throw new AppError('Token não fornecido', 401)
    }

    const token = authHeader.replace('Bearer ', '')

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET)
    } catch {
        throw new AppError('Token inválido', 401)
    }
}

// O papel é conferido no banco (e não só no token), para que uma troca de papel valha na hora.
export function authorize(allowedRoles = []) {
    return async function (req) {
        if (!req.user?.id) {
            throw new AppError('Token inválido', 401)
        }

        const user = await UserModel.findById(req.user.id, 'role')
        if (!user) {
            throw new AppError('Usuário não encontrado', 404)
        }

        if (!allowedRoles.includes(user.role)) {
            throw new AppError('Acesso negado', 403)
        }
    }
}
