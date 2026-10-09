import jwt from 'jsonwebtoken'
import AppError from '../../errors/AppError.js'

// Sessão do cliente final. Usa um segredo DIFERENTE do painel: um token do portal nunca abre as rotas do
// programador, e um token do painel nunca abre o portal.
function segredo() {
    return `${process.env.JWT_SECRET}:portal`
}

export function assinarTokensDoPortal(contratante) {
    const accessToken = jwt.sign({ cid: contratante._id, tenantId: contratante.tenantId }, segredo(), { expiresIn: '1d' })
    const refreshToken = jwt.sign({ cid: contratante._id, tipo: 'refresh' }, segredo(), { expiresIn: '30d' })
    return { accessToken, refreshToken }
}

export function lerToken(token) {
    return jwt.verify(String(token ?? ''), segredo())
}

export async function authenticateContratante(req) {
    const token = String(req.headers.authorization ?? '').replace('Bearer ', '')
    if (!token) {
        throw new AppError('Token não fornecido', 401)
    }
    let dados
    try {
        dados = lerToken(token)
    } catch {
        throw new AppError('Token inválido', 401)
    }
    if (dados.tipo || !dados.cid) {
        throw new AppError('Token inválido', 401)
    }
    req.contratante = { id: dados.cid, tenantId: dados.tenantId }
}
