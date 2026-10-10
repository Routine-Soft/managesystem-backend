import argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import UserModel from './user.model.js'
import { AssinaturaService } from '../assinatura/assinatura.service.js'
import { registroDTO, membroDTO, atualizarMembroDTO, atualizarMeDTO, loginDTO } from './user.dto.js'
import AppError from '../../errors/AppError.js'
import { exigirId } from '../shared/utils/ids.js'

const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function validarSenha(senha) {
    if (!senha || senha.length < 6) {
        throw new AppError('A senha deve ter ao menos 6 caracteres', 400)
    }
}

function validarEmail(email) {
    if (!EMAIL_VALIDO.test(email)) {
        throw new AppError('Informe um e-mail válido', 400)
    }
}

function erroDeEmailDuplicado(error) {
    if (error.code === 11000) {
        return new AppError('Já existe um usuário com este e-mail', 409)
    }
    return error
}

function assinarTokens(user) {
    const payload = { id: user._id, tenantId: user.tenantId, role: user.role }
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' })
    const refreshToken = jwt.sign({ id: user._id, tipo: 'refresh' }, process.env.JWT_SECRET, { expiresIn: '30d' })
    return { accessToken, refreshToken }
}

async function emitirSessao(user) {
    const { accessToken, refreshToken } = assinarTokens(user)
    user.tokenRefresh = refreshToken
    await user.save()
    return { accessToken, refreshToken, user: user.toJSON() }
}

// Cria a conta (o dono é o próprio tenant) com o período de teste grátis. Usado no cadastro público e pelo super_admin.
export async function criarConta(body) {
    const dto = registroDTO(body ?? {})
    if (!dto.nomeCompleto || !dto.nomeEmpresa) {
        throw new AppError('Informe seu nome e o nome da empresa', 400)
    }
    validarEmail(dto.email)
    validarSenha(dto.password)

    const newId = new mongoose.Types.ObjectId()
    let user
    try {
        user = await UserModel.create({ ...dto, _id: newId, tenantId: newId, role: 'admin', password: await argon2.hash(dto.password) })
    } catch (error) {
        throw erroDeEmailDuplicado(error)
    }
    await AssinaturaService.criarAssinaturaTrial(newId)
    return user
}

export { validarEmail, validarSenha, erroDeEmailDuplicado }

export const UserService = {
    // Cadastro público: cria a conta e já entra.
    async registrar(body) {
        return await emitirSessao(await criarConta(body))
    },

    async login(body) {
        const { email, password } = loginDTO(body)
        const user = await UserModel.findOne({ email })
        if (!user || !(await argon2.verify(user.password, password).catch(() => false))) {
            throw new AppError('E-mail ou senha incorretos', 401)
        }
        return await emitirSessao(user)
    },

    async logout(id) {
        await UserModel.updateOne({ _id: id }, { $set: { tokenRefresh: null } })
        return null
    },

    async refresh(refreshToken) {
        let decoded
        try {
            decoded = jwt.verify(String(refreshToken ?? ''), process.env.JWT_SECRET)
        } catch {
            throw new AppError('Sessão expirada. Entre novamente.', 401)
        }

        const user = await UserModel.findById(decoded.id)
        if (!user || decoded.tipo !== 'refresh' || user.tokenRefresh !== refreshToken) {
            throw new AppError('Sessão expirada. Entre novamente.', 401)
        }

        return { accessToken: assinarTokens(user).accessToken }
    },

    async findMe(id) {
        const user = await UserModel.findById(id)
        if (!user) {
            throw new AppError('Usuário não encontrado', 404)
        }
        return user
    },

    async updateMe(id, tenantId, role, body) {
        const dto = atualizarMeDTO(body ?? {}, role)
        if ('email' in dto) validarEmail(dto.email)
        if ('nomeCompleto' in dto && !dto.nomeCompleto) delete dto.nomeCompleto

        let user
        try {
            user = await UserModel.findByIdAndUpdate(id, { $set: dto }, { new: true, runValidators: true })
        } catch (error) {
            throw erroDeEmailDuplicado(error)
        }
        if (!user) {
            throw new AppError('Usuário não encontrado', 404)
        }

        // O nome da empresa e o país são os mesmos para toda a equipe.
        const daConta = Object.fromEntries(Object.entries({ nomeEmpresa: dto.nomeEmpresa, pais: dto.pais }).filter(([, v]) => v))
        if (Object.keys(daConta).length) {
            await UserModel.updateMany({ tenantId }, { $set: daConta })
        }
        return user
    },

    async updateMyPassword(id, body) {
        const { currentPassword, newPassword } = body ?? {}
        validarSenha(newPassword)

        const user = await UserModel.findById(id)
        if (!user) {
            throw new AppError('Usuário não encontrado', 404)
        }
        if (!(await argon2.verify(user.password, String(currentPassword ?? '')).catch(() => false))) {
            throw new AppError('Senha atual incorreta', 400)
        }

        user.password = await argon2.hash(newPassword)
        await user.save()
        return null
    },

    // ----- Equipe (usuários da mesma conta) -----

    async listarEquipe(tenantId) {
        return await UserModel.find({ tenantId }).sort({ createdAt: 1 })
    },

    async criarMembro(tenantId, body) {
        const dto = membroDTO(body ?? {})
        if (!dto.nomeCompleto) {
            throw new AppError('Informe o nome', 400)
        }
        validarEmail(dto.email)
        validarSenha(dto.password)

        const dono = await UserModel.findById(tenantId, 'nomeEmpresa pais')
        try {
            return await UserModel.create({
                ...dto,
                tenantId,
                nomeEmpresa: dono?.nomeEmpresa ?? '',
                pais: dono?.pais ?? 'BR',
                password: await argon2.hash(dto.password),
            })
        } catch (error) {
            throw erroDeEmailDuplicado(error)
        }
    },

    async atualizarMembro(tenantId, id, body) {
        exigirId(id, 'Usuário não encontrado')
        const dto = atualizarMembroDTO(body ?? {})
        if ('email' in dto) validarEmail(dto.email)
        if ('nomeCompleto' in dto && !dto.nomeCompleto) delete dto.nomeCompleto
        // O dono da conta continua sempre admin.
        if (String(id) === String(tenantId)) delete dto.role

        let user
        try {
            user = await UserModel.findOneAndUpdate({ _id: id, tenantId }, { $set: dto }, { new: true, runValidators: true })
        } catch (error) {
            throw erroDeEmailDuplicado(error)
        }
        if (!user) {
            throw new AppError('Usuário não encontrado', 404)
        }
        return user
    },

    async redefinirSenhaMembro(tenantId, id, novaSenha) {
        exigirId(id, 'Usuário não encontrado')
        validarSenha(novaSenha)
        const user = await UserModel.findOne({ _id: id, tenantId })
        if (!user) {
            throw new AppError('Usuário não encontrado', 404)
        }
        user.password = await argon2.hash(novaSenha)
        user.tokenRefresh = null
        await user.save()
        return null
    },

    async removerMembro(tenantId, id, quemRemove) {
        exigirId(id, 'Usuário não encontrado')
        if (String(id) === String(tenantId)) {
            throw new AppError('O dono da conta não pode ser removido', 400)
        }
        if (String(id) === String(quemRemove)) {
            throw new AppError('Você não pode remover a si mesmo', 400)
        }
        const user = await UserModel.findOneAndDelete({ _id: id, tenantId })
        if (!user) {
            throw new AppError('Usuário não encontrado', 404)
        }
        return null
    },
}
