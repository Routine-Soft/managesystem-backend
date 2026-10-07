export function normalizarEmail(email) {
    return String(email ?? '').replace(/\s+/g, '').toLowerCase()
}

function texto(valor) {
    return String(valor ?? '').trim()
}

export function registroDTO(body) {
    return {
        nomeCompleto: texto(body.nomeCompleto),
        email: normalizarEmail(body.email),
        password: String(body.password ?? ''),
        telefone: texto(body.telefone) || null,
        nomeEmpresa: texto(body.nomeEmpresa),
        idioma: body.idioma === 'en' ? 'en' : 'pt',
    }
}

export function membroDTO(body) {
    return {
        nomeCompleto: texto(body.nomeCompleto),
        email: normalizarEmail(body.email),
        password: String(body.password ?? ''),
        telefone: texto(body.telefone) || null,
        role: body.role === 'admin' ? 'admin' : 'membro',
        idioma: body.idioma === 'en' ? 'en' : 'pt',
    }
}

export function atualizarMembroDTO(body) {
    const dto = {}
    if ('nomeCompleto' in body) dto.nomeCompleto = texto(body.nomeCompleto)
    if ('email' in body) dto.email = normalizarEmail(body.email)
    if ('telefone' in body) dto.telefone = texto(body.telefone) || null
    if ('role' in body) dto.role = body.role === 'admin' ? 'admin' : 'membro'
    return dto
}

export function atualizarMeDTO(body, role) {
    const dto = {}
    if ('nomeCompleto' in body) dto.nomeCompleto = texto(body.nomeCompleto)
    if ('email' in body) dto.email = normalizarEmail(body.email)
    if ('telefone' in body) dto.telefone = texto(body.telefone) || null
    if ('idioma' in body) dto.idioma = body.idioma === 'en' ? 'en' : 'pt'
    if ('nomeEmpresa' in body && ['admin', 'super_admin'].includes(role) && texto(body.nomeEmpresa)) {
        dto.nomeEmpresa = texto(body.nomeEmpresa)
    }
    return dto
}

export function loginDTO(body) {
    return {
        email: normalizarEmail(body?.email),
        password: String(body?.password ?? ''),
    }
}
