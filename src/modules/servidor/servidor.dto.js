import AppError from '../../errors/AppError.js'

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
    return dto
}
