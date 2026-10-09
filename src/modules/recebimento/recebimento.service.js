import RecebimentoModel from './recebimento.model.js'
import { mercadoPago, stripeDaChave } from './recebimento.gateways.js'
import { cifrar, decifrar, finalDaChave } from '../shared/utils/cripto.js'
import AppError from '../../errors/AppError.js'

const VAZIO = { chaveCifrada: null, final: null, conta: null, contaId: null, conectadoEm: null }

export const RecebimentoService = {
    async obter(tenantId) {
        return await RecebimentoModel.findOneAndUpdate(
            { tenantId },
            { $setOnInsert: { tenantId } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        )
    },

    // Access token de produção do Mercado Pago (Suas integrações > Credenciais). Testado antes de salvar.
    async conectarMercadoPago(tenantId, accessToken) {
        const token = String(accessToken ?? '').trim()
        if (!/^(APP_USR|TEST)-[\w-]{20,}$/.test(token)) {
            throw new AppError('Cole o "Access Token" do Mercado Pago (começa com APP_USR-).', 400)
        }
        let eu
        try {
            eu = await mercadoPago(token, 'GET', '/users/me')
        } catch {
            throw new AppError('O Mercado Pago não aceitou este Access Token. Confira se copiou inteiro.', 400)
        }
        if (eu.site_id && eu.site_id !== 'MLB') {
            throw new AppError('Use uma conta do Mercado Pago do Brasil.', 400)
        }

        const recebimento = await this.obter(tenantId)
        recebimento.mercadoPago = {
            chaveCifrada: cifrar(token),
            final: finalDaChave(token),
            conta: eu.nickname || eu.email || null,
            contaId: eu.id ? String(eu.id) : null,
            conectadoEm: new Date(),
        }
        await recebimento.save()
        return recebimento
    },

    // Chave secreta (sk_live_...) ou restrita (rk_live_...) do Stripe. Testada antes de salvar.
    async conectarStripe(tenantId, chaveSecreta) {
        const chave = String(chaveSecreta ?? '').trim()
        if (!/^(sk|rk)_(live|test)_[\w]{10,}$/.test(chave)) {
            throw new AppError('Cole a chave secreta do Stripe (começa com sk_live_ ou rk_live_).', 400)
        }
        const stripe = stripeDaChave(chave)
        let conta = null
        try {
            conta = await stripe.accounts.retrieve().catch(async (error) => {
                // Chave restrita sem permissão de ler a conta: basta conseguir usar o Checkout.
                if (error?.type === 'StripePermissionError') {
                    await stripe.checkout.sessions.list({ limit: 1 })
                    return null
                }
                throw error
            })
        } catch {
            throw new AppError('O Stripe não aceitou esta chave. Confira se copiou inteira e se ela pode criar pagamentos (Checkout).', 400)
        }

        const recebimento = await this.obter(tenantId)
        recebimento.stripe = {
            chaveCifrada: cifrar(chave),
            final: finalDaChave(chave),
            conta: conta?.business_profile?.name || conta?.email || conta?.settings?.dashboard?.display_name || null,
            contaId: conta?.id ?? null,
            conectadoEm: new Date(),
        }
        await recebimento.save()
        return recebimento
    },

    async desconectar(tenantId, gateway) {
        const recebimento = await this.obter(tenantId)
        recebimento[gateway === 'stripe' ? 'stripe' : 'mercadoPago'] = { ...VAZIO }
        await recebimento.save()
        return recebimento
    },

    // Usados na cobrança das faturas.
    async tokenMercadoPago(tenantId) {
        const r = await RecebimentoModel.findOne({ tenantId })
        return decifrar(r?.mercadoPago?.chaveCifrada)
    },

    async stripeDoTenant(tenantId) {
        const r = await RecebimentoModel.findOne({ tenantId })
        const chave = decifrar(r?.stripe?.chaveCifrada)
        return chave ? stripeDaChave(chave) : null
    },
}
