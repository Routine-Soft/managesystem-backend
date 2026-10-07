// Tradução do estado da assinatura do Stripe para o estado interno. Funções puras (sem banco nem rede).

// Nas versões novas da API do Stripe o fim do período fica nos itens da assinatura; nas antigas, na própria assinatura.
export function fimDoPeriodo(sub) {
    const segundos = sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end
    return segundos ? new Date(segundos * 1000) : null
}

export function precoDaAssinatura(sub) {
    return sub?.items?.data?.[0]?.price?.id ?? null
}

// `voltarAoGratuito` é chamado quando a assinatura termina sem nunca ter tido um período pago.
export function aplicarStatusStripe(assinatura, sub, voltarAoGratuito) {
    const fim = fimDoPeriodo(sub)
    assinatura.stripeSubscriptionId = sub.id
    if (sub.customer) assinatura.stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id

    switch (sub.status) {
        case 'active':
        case 'trialing':
            assinatura.cobranca = 'stripe'
            assinatura.inadimplenteDesde = null
            assinatura.proximaCobranca = fim
            // Cancelada no portal "ao fim do período": continua com acesso até lá, sem renovar.
            assinatura.status = sub.cancel_at_period_end || sub.cancel_at ? 'cancelada' : 'ativa'
            break

        case 'past_due':
        case 'unpaid':
            if (assinatura.status !== 'inadimplente') assinatura.inadimplenteDesde = new Date()
            assinatura.status = 'inadimplente'
            break

        case 'canceled':
            if (assinatura.proximaCobranca) {
                assinatura.status = 'cancelada'
            } else {
                voltarAoGratuito(assinatura)
            }
            assinatura.stripeSubscriptionId = null
            break

        // incomplete / incomplete_expired / paused: primeira cobrança ainda não passou; nada muda.
        default:
            break
    }
    return assinatura
}
