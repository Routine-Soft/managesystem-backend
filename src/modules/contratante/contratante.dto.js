import mongoose from 'mongoose'
import AppError from '../../errors/AppError.js'
import { paisValido, moedaValida, ehBrasil } from '../shared/utils/pais.js'

const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function normalizarEmail(email) {
    return String(email ?? '').replace(/\s+/g, '').toLowerCase()
}

function ids(valor) {
    return Array.isArray(valor) ? [...new Set(valor.map(String))].filter((id) => mongoose.isValidObjectId(id)).slice(0, 50) : []
}

function valor(v) {
    const n = Number(String(v ?? '').replace(',', '.'))
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

export function contratanteDTO(body) {
    const dto = {}
    if ('nome' in body) dto.nome = String(body.nome ?? '').trim().slice(0, 120)
    if ('email' in body) {
        dto.email = normalizarEmail(body.email)
        if (!EMAIL_VALIDO.test(dto.email)) {
            throw new AppError('Informe um e-mail válido', 400)
        }
    }
    if ('pais' in body) dto.pais = paisValido(body.pais) ?? 'BR'
    if ('idioma' in body) dto.idioma = body.idioma === 'en' ? 'en' : 'pt'
    if ('servidores' in body) dto.servidores = ids(body.servidores)
    if ('sites' in body) dto.sites = ids(body.sites)

    if (body.cobranca && typeof body.cobranca === 'object') {
        const c = body.cobranca
        const itens = (Array.isArray(c.itens) ? c.itens : [])
            .map((i) => ({ descricao: String(i?.descricao ?? '').trim().slice(0, 80), valor: valor(i?.valor) }))
            .filter((i) => i.descricao && i.valor !== null)
            .slice(0, 10)
        const dia = Math.round(Number(c.diaVencimento))
        dto.cobranca = {
            ativa: !!c.ativa,
            moeda: moedaValida(c.moeda) ?? 'USD',
            // Até o dia 28 para existir em todos os meses.
            diaVencimento: Number.isFinite(dia) ? Math.min(Math.max(dia, 1), 28) : 10,
            itens,
        }
        if (dto.cobranca.ativa && !itens.some((i) => i.valor > 0)) {
            throw new AppError('Para cobrar, informe ao menos um item com valor', 400)
        }
    }
    return dto
}

// No Brasil o pagamento é pelo Mercado Pago, que só cobra em reais.
export function ajustarMoeda(dto, paisAtual) {
    const pais = dto.pais ?? paisAtual
    if (dto.cobranca && ehBrasil(pais)) dto.cobranca.moeda = 'BRL'
    return dto
}
