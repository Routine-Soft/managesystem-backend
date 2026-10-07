import { MENSAGENS_EN } from './mensagens.en.js'

// O código e as mensagens ficam em português; em inglês a mensagem é trocada pela tradução na saída.
export function idiomaDaRequisicao(req) {
    return String(req.headers['accept-language'] ?? '').toLowerCase().startsWith('en') ? 'en' : 'pt'
}

function formatarParametro(valor, idioma) {
    if (valor instanceof Date || (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valor))) {
        return new Date(valor).toLocaleDateString(idioma === 'en' ? 'en-US' : 'pt-BR', { timeZone: 'America/Sao_Paulo' })
    }
    return String(valor ?? '')
}

export function traduzir(mensagem, idioma, params) {
    const texto = idioma === 'en' ? (MENSAGENS_EN[mensagem] ?? mensagem) : mensagem
    if (!params) return texto
    return texto.replace(/\{(\w+)\}/g, (trecho, chave) => (chave in params ? formatarParametro(params[chave], idioma) : trecho))
}
