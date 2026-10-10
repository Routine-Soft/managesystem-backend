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

// Quanto vale 1 unidade de cada moeda (USD, EUR, BRL) na moeda de destino. Ex.: destino BRL → { USD: 5.01, EUR: 5.85, BRL: 1 }.
// Usado só para mostrar valores convertidos na tela (custo do servidor em euro, por exemplo). Guardado por 1 hora.
const MOEDAS_CONVERTIDAS = ['USD', 'EUR', 'BRL']
const cacheDeCotacoes = {}

async function cotacoesAwesome(destino) {
    const pares = MOEDAS_CONVERTIDAS.filter((m) => m !== destino).map((m) => `${m}-${destino}`).join(',')
    const r = await fetch(`https://economia.awesomeapi.com.br/json/last/${pares}`, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = await r.json()
    return Object.fromEntries(MOEDAS_CONVERTIDAS.map((m) => [m, m === destino ? 1 : Number(j?.[`${m}${destino}`]?.bid)]))
}

async function cotacoesEr(destino) {
    const r = await fetch(`https://open.er-api.com/v6/latest/${destino}`, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const taxas = (await r.json())?.rates ?? {}
    // A API diz quantas unidades de cada moeda valem 1 destino; aqui é o contrário.
    return Object.fromEntries(MOEDAS_CONVERTIDAS.map((m) => [m, m === destino ? 1 : 1 / Number(taxas[m])]))
}

export async function cotacoesPara(destino) {
    if (!MOEDAS_CONVERTIDAS.includes(destino)) return null
    const guardada = cacheDeCotacoes[destino]
    if (guardada && Date.now() - guardada.em < VALIDADE_MS) return guardada.valores
    for (const fonte of [cotacoesAwesome, cotacoesEr]) {
        const valores = await fonte(destino).catch(() => null)
        if (valores && Object.values(valores).every((v) => Number.isFinite(v) && v > 0)) {
            cacheDeCotacoes[destino] = { valores, em: Date.now() }
            return valores
        }
    }
    return guardada?.valores ?? null
}
