import Stripe from 'stripe'
import { MP_API } from '../../config/mercadopago.js'

// Chamadas aos gateways com a chave DO PROGRAMADOR (não a do ManageSystem).

export async function mercadoPago(token, metodo, caminho, corpo) {
    const resposta = await fetch(`${MP_API}${caminho}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(15000),
    })
    const dados = await resposta.json().catch(() => ({}))
    if (!resposta.ok) {
        const detalhes = Array.isArray(dados.cause) ? dados.cause.map((c) => c.description).filter(Boolean) : []
        const erro = new Error([dados.message, ...detalhes].filter(Boolean).join(' — ') || `HTTP ${resposta.status}`)
        erro.status = resposta.status
        throw erro
    }
    return dados
}

export function stripeDaChave(chave) {
    return new Stripe(chave, { maxNetworkRetries: 2, timeout: 15000 })
}
