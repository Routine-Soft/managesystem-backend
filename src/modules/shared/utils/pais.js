// País de quem paga decide o meio de pagamento:
//  - Brasil: só Mercado Pago (Pix e cartão nacional, o dinheiro cai rápido)
//  - outros países: só Stripe (cartão internacional)

export function paisValido(valor) {
    const pais = String(valor ?? '').trim().toUpperCase()
    return /^[A-Z]{2}$/.test(pais) ? pais : null
}

export function ehBrasil(pais) {
    return paisValido(pais) === 'BR'
}

export function gatewayDoPais(pais) {
    return ehBrasil(pais) ? 'mercadopago' : 'stripe'
}

// Moedas aceitas na cobrança do programador para o cliente dele. No Brasil (Mercado Pago) é sempre real.
export const MOEDAS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'BRL']

export function moedaValida(valor) {
    const moeda = String(valor ?? '').trim().toUpperCase()
    return MOEDAS.includes(moeda) ? moeda : null
}
