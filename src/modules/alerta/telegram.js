// Bot do Telegram (um só para o sistema todo). Grátis: só precisa do token do @BotFather.
const API = 'https://api.telegram.org'

export function telegramConfigurado() {
    return !!process.env.TELEGRAM_BOT_TOKEN
}

async function chamar(metodo, corpo) {
    const resposta = await fetch(`${process.env.TELEGRAM_API_URL || API}/bot${process.env.TELEGRAM_BOT_TOKEN}/${metodo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo ?? {}),
        signal: AbortSignal.timeout(40000),
    })
    const dados = await resposta.json().catch(() => ({}))
    if (!dados.ok) {
        throw new Error(dados.description || `Telegram respondeu ${resposta.status}`)
    }
    return dados.result
}

let nomeDoBot = null

export async function usuarioDoBot() {
    if (!nomeDoBot) {
        const eu = await chamar('getMe')
        nomeDoBot = eu.username
    }
    return nomeDoBot
}

// Texto em HTML simples do Telegram (<b>, <i>, <code>). Quem chama escapa o que veio de fora.
export async function enviarMensagem(chatId, texto) {
    return await chamar('sendMessage', { chat_id: chatId, text: texto, parse_mode: 'HTML', disable_web_page_preview: true })
}

export function escapar(texto) {
    return String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function definirWebhook(url, segredo) {
    return await chamar('setWebhook', { url, secret_token: segredo, allowed_updates: ['message'] })
}

export async function removerWebhook() {
    return await chamar('deleteWebhook', {})
}

export async function buscarAtualizacoes(offset) {
    return await chamar('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] })
}
