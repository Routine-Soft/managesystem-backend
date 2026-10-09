function numeroOuNulo(valor) {
    if (valor === null || valor === undefined || valor === '') return null
    const n = Number(valor)
    return Number.isFinite(n) && n >= 0 ? n : null
}

const CAMPOS = ['nome', 'descricao', 'tipo', 'precoUSD', 'stripePriceId', 'duracaoDiasTrial', 'limiteServidores', 'limiteSites', 'ativo']

export function planoDTO(body) {
    const dto = Object.fromEntries(Object.entries(body ?? {}).filter(([chave]) => CAMPOS.includes(chave)))
    if ('nome' in dto) dto.nome = String(dto.nome ?? '').trim()
    if ('descricao' in dto) dto.descricao = String(dto.descricao ?? '').trim()
    if ('tipo' in dto) dto.tipo = dto.tipo === 'gratis' ? 'gratis' : 'pago'
    if ('precoUSD' in dto) dto.precoUSD = numeroOuNulo(dto.precoUSD) ?? 0
    if ('stripePriceId' in dto) dto.stripePriceId = String(dto.stripePriceId ?? '').trim() || null
    if ('duracaoDiasTrial' in dto) dto.duracaoDiasTrial = numeroOuNulo(dto.duracaoDiasTrial)
    if ('limiteServidores' in dto) dto.limiteServidores = numeroOuNulo(dto.limiteServidores)
    if ('limiteSites' in dto) dto.limiteSites = numeroOuNulo(dto.limiteSites)
    if ('ativo' in dto) dto.ativo = !!dto.ativo
    return dto
}
