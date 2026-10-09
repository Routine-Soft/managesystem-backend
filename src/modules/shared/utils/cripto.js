import crypto from 'node:crypto'
import AppError from '../../../errors/AppError.js'

// Guarda segredos de terceiros (chaves do Mercado Pago e do Stripe dos programadores) cifrados no banco.
// AES-256-GCM com a chave CHAVE_CRIPTOGRAFIA do .env (64 caracteres hexadecimais = 32 bytes).

function chave() {
    const hex = String(process.env.CHAVE_CRIPTOGRAFIA ?? '')
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new AppError('O recebimento de pagamentos ainda não está configurado no sistema. Fale com o suporte.', 503)
    }
    return Buffer.from(hex, 'hex')
}

export function cifrar(texto) {
    const iv = crypto.randomBytes(12)
    const cifra = crypto.createCipheriv('aes-256-gcm', chave(), iv)
    const dados = Buffer.concat([cifra.update(String(texto), 'utf8'), cifra.final()])
    return [iv, cifra.getAuthTag(), dados].map((b) => b.toString('base64')).join('.')
}

export function decifrar(valor) {
    if (!valor) return null
    const [iv, tag, dados] = String(valor).split('.').map((p) => Buffer.from(p, 'base64'))
    const decifra = crypto.createDecipheriv('aes-256-gcm', chave(), iv)
    decifra.setAuthTag(tag)
    return Buffer.concat([decifra.update(dados), decifra.final()]).toString('utf8')
}

// Só o final da chave aparece na tela (ex.: "••••a1b2").
export function finalDaChave(texto) {
    return `••••${String(texto).slice(-4)}`
}

export function hashDoToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex')
}
