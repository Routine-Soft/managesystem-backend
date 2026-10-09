import AppError from '../../../errors/AppError.js'

// Cotação do dólar em reais, usada quando um brasileiro paga em Pix um plano com preço em dólar.
// Fica guardada por 1 hora para não consultar a cada tela.

const VALIDADE_MS = 60 * 60 * 1000
let cache = null

async function awesomeApi() {
    const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', { signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return Number((await r.json())?.USDBRL?.bid)
}

async function erApi() {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return Number((await r.json())?.rates?.BRL)
}

export async function cotacaoDoDolar() {
    if (cache && Date.now() - cache.em < VALIDADE_MS) return cache.valor
    for (const fonte of [awesomeApi, erApi]) {
        const valor = await fonte().catch(() => null)
        if (Number.isFinite(valor) && valor > 1 && valor < 50) {
            cache = { valor, em: Date.now() }
            return valor
        }
    }
    // Sem nenhuma fonte agora: usa a última conhecida, mesmo antiga.
    if (cache) return cache.valor
    throw new AppError('Não foi possível consultar a cotação do dólar agora. Tente de novo em instantes.', 503)
}

export function emReais(valorUSD, cotacao) {
    return Math.round(valorUSD * cotacao * 100) / 100
}
