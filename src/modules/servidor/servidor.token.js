import crypto from 'node:crypto'

// Token do agente: aparece só no comando de instalação; no banco fica o hash.
export function gerarTokenDoAgente() {
    const token = `msa_${crypto.randomBytes(24).toString('base64url')}`
    return { token, hash: hashDoToken(token) }
}

export function hashDoToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex')
}

export function urlPublicaDaApi() {
    return (process.env.APP_URL_BACKEND || `http://localhost:${process.env.PORT || 8080}`).replace(/\/+$/, '')
}

export function comandoDeInstalacao(token) {
    return `curl -fsSL ${urlPublicaDaApi()}/api/agente/install.sh | sudo bash -s -- --token ${token}`
}

export function comandoDeRemocao() {
    return `curl -fsSL ${urlPublicaDaApi()}/api/agente/install.sh | sudo bash -s -- --remover`
}
