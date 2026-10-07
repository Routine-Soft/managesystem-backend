// Mercado Pago é usado só para o Pix (Brasil). As chamadas são feitas por fetch na API REST.
export const MP_API = process.env.MP_API_URL || 'https://api.mercadopago.com'

export function mercadoPagoConfigurado() {
    return !!process.env.MP_ACCESS_TOKEN
}
