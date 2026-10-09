import AppError from '../../errors/AppError.js'
import { moedaValida } from '../shared/utils/pais.js'

// URL monitorada: só http(s); sem protocolo, assume https.
export function normalizarUrl(valor) {
    const texto = String(valor ?? '').trim()
    if (!texto) return null
    const comProtocolo = /^https?:\/\//i.test(texto) ? texto : `https://${texto}`
    let url
    try {
        url = new URL(comProtocolo)
    } catch {
        throw new AppError('Endereço (URL) inválido', 400)
    }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) {
        throw new AppError('Endereço (URL) inválido', 400)
    }
    return url.toString()
}

export function servidorDTO(body) {
    const dto = {}
    if ('nome' in body) dto.nome = String(body.nome ?? '').trim()
    if ('url' in body) dto.url = normalizarUrl(body.url)
    if ('limiteLentidaoMs' in body) {
        const ms = Number(body.limiteLentidaoMs)
        dto.limiteLentidaoMs = Number.isFinite(ms) ? Math.min(Math.max(Math.round(ms), 300), 30000) : 3000
    }
    if (body.custo && typeof body.custo === 'object') {
        const valor = body.custo.valor === '' || body.custo.valor === null ? null : Number(String(body.custo.valor).replace(',', '.'))
        dto.custo = {
            valor: Number.isFinite(valor) && valor >= 0 ? Math.round(valor * 100) / 100 : null,
            moeda: moedaValida(body.custo.moeda) ?? 'USD',
            provedor: String(body.custo.provedor ?? '').trim().slice(0, 60) || null,
        }
    }
    return dto
}
