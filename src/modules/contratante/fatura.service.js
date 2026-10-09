import FaturaModel from './fatura.model.js'
import ContratanteModel from './contratante.model.js'
import UserModel from '../user/user.model.js'
import { RecebimentoService } from '../recebimento/recebimento.service.js'
import { mercadoPago } from '../recebimento/recebimento.gateways.js'
import { AlertaService } from '../alerta/alerta.service.js'
import { gatewayDoPais } from '../shared/utils/pais.js'
import { urlPublicaDaApi } from '../servidor/servidor.token.js'
import AppError from '../../errors/AppError.js'

const DIA_MS = 24 * 60 * 60 * 1000
// A fatura do mês aparece para o cliente alguns dias antes de vencer.
export const DIAS_ANTES_DO_VENCIMENTO = 7
// Um link de pagamento recente é reaproveitado (evita várias cobranças abertas para a mesma fatura).
const VALIDADE_DO_CHECKOUT_MS = 12 * 60 * 60 * 1000

// Frontend usa HashRouter: as rotas ficam depois do "#".
export function urlDoPortal(rota) {
    const base = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '')
    return `${base}/#/portal${rota}`
}

// Vencimento no dia escolhido, ao meio-dia UTC (o mesmo dia no Brasil e na maior parte do mundo).
export function vencimentoDoMes(ano, mes, dia) {
    return new Date(Date.UTC(ano, mes, dia, 12))
}

export function competenciaDe(data) {
    return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`
}

function totalDosItens(itens) {
    return Math.round(itens.reduce((soma, i) => soma + i.valor, 0) * 100) / 100
}

function centavos(valor) {
    return Math.round(valor * 100)
}

async function criarFatura(contratante, vencimento) {
    const itens = contratante.cobranca.itens.filter((i) => i.valor > 0).map((i) => ({ descricao: i.descricao, valor: i.valor }))
    const fatura = await FaturaModel.create({
        tenantId: contratante.tenantId,
        contratanteId: contratante._id,
        competencia: competenciaDe(vencimento),
        vencimento,
        itens,
        total: totalDosItens(itens),
        moeda: contratante.cobranca.moeda,
    })
    await AlertaService.notificarContratante(contratante, 'faturaNova', {
        total: fatura.total, moeda: fatura.moeda, vencimento: fatura.vencimento, link: urlDoPortal(''),
    })
    return fatura
}

export const FaturaService = {
    // Rotina: cria a fatura do mês para quem tem cobrança ligada, DIAS_ANTES_DO_VENCIMENTO antes de vencer.
    async gerarFaturasDoPeriodo(agora = new Date()) {
        const contratantes = await ContratanteModel.find({ 'cobranca.ativa': true })
        let criadas = 0
        for (const c of contratantes) {
            if (!c.cobranca.itens.some((i) => i.valor > 0)) continue
            // Este mês e o próximo (ex.: vence dia 3 e hoje é dia 28).
            for (const deslocamento of [0, 1]) {
                const vencimento = vencimentoDoMes(agora.getUTCFullYear(), agora.getUTCMonth() + deslocamento, c.cobranca.diaVencimento)
                const ativadaEm = c.cobranca.ativadaEm ?? c.createdAt
                // Vencimento anterior à cobrança ser ligada não gera fatura atrasada.
                if (vencimento.getTime() - DIAS_ANTES_DO_VENCIMENTO * DIA_MS > agora.getTime()) continue
                if (vencimento.getTime() < new Date(ativadaEm).getTime() - DIA_MS) continue
                if (await FaturaModel.exists({ contratanteId: c._id, competencia: competenciaDe(vencimento) })) continue
                try {
                    await criarFatura(c, vencimento)
                    criadas++
                } catch (error) {
                    if (error.code !== 11000) throw error
                }
            }
        }
        return criadas
    },

    // Botão "Gerar fatura agora" do programador: a do mês atual (ou do próximo, se a deste mês já existe).
    async gerarAgora(contratante) {
        if (!contratante.cobranca?.itens?.some((i) => i.valor > 0)) {
            throw new AppError('Cadastre a mensalidade (itens e valores) antes de gerar a fatura', 400)
        }
        const agora = new Date()
        for (const deslocamento of [0, 1]) {
            const vencimento = vencimentoDoMes(agora.getUTCFullYear(), agora.getUTCMonth() + deslocamento, contratante.cobranca.diaVencimento)
            if (!(await FaturaModel.exists({ contratanteId: contratante._id, competencia: competenciaDe(vencimento) }))) {
                return await criarFatura(contratante, vencimento)
            }
        }
        throw new AppError('As faturas deste mês e do próximo já foram geradas', 409)
    },

    // ----- Pagamento pelo cliente (portal) -----

    async linkDePagamento(contratante, faturaId) {
        const fatura = await FaturaModel.findOne({ _id: faturaId, contratanteId: contratante._id })
        if (!fatura) {
            throw new AppError('Fatura não encontrada', 404)
        }
        await this.sincronizar(fatura).catch(() => null)
        if (fatura.status !== 'aberta') {
            throw new AppError('Esta fatura não está em aberto', 409)
        }

        const gateway = gatewayDoPais(contratante.pais)
        const recente = [...fatura.tentativas].reverse().find((t) => t.gateway === gateway && Date.now() - new Date(t.em).getTime() < VALIDADE_DO_CHECKOUT_MS)
        if (recente) return { url: recente.url }

        const tentativa = gateway === 'mercadopago'
            ? await this.checkoutMercadoPago(contratante, fatura)
            : await this.checkoutStripe(contratante, fatura)
        fatura.tentativas.push({ ...tentativa, gateway, em: new Date() })
        // Guarda só as últimas tentativas.
        fatura.tentativas = fatura.tentativas.slice(-10)
        await fatura.save()
        return { url: tentativa.url }
    },

    async checkoutMercadoPago(contratante, fatura) {
        if (fatura.moeda !== 'BRL') {
            throw new AppError('O Mercado Pago só cobra em reais. Peça ao responsável para ajustar a moeda da cobrança.', 400)
        }
        const token = await RecebimentoService.tokenMercadoPago(contratante.tenantId)
        if (!token) {
            throw new AppError('O pagamento online ainda não foi configurado pelo responsável. Fale com ele.', 400)
        }
        const empresa = (await UserModel.findById(contratante.tenantId, 'nomeEmpresa'))?.nomeEmpresa ?? ''
        const retorno = urlDoPortal(`/retorno?fatura=${fatura._id}`)
        const corpo = {
            items: fatura.itens.map((i) => ({ title: `${i.descricao} (${fatura.competencia})`, quantity: 1, unit_price: i.valor, currency_id: 'BRL' })),
            external_reference: `fatura:${fatura._id}`,
            payer: { email: contratante.email, name: contratante.nome },
            statement_descriptor: empresa.slice(0, 22) || undefined,
            back_urls: { success: retorno, failure: retorno, pending: retorno },
            auto_return: 'approved',
        }
        const api = urlPublicaDaApi()
        if (api.startsWith('https://')) {
            corpo.notification_url = `${api}/api/portal/mercadopago/webhook/${contratante.tenantId}`
        }
        try {
            const preferencia = await mercadoPago(token, 'POST', '/checkout/preferences', corpo)
            return { id: String(preferencia.id), url: preferencia.init_point }
        } catch (error) {
            throw new AppError('Não foi possível abrir o pagamento no Mercado Pago: {detalhe}', 502, null, { detalhe: error.message })
        }
    },

    async checkoutStripe(contratante, fatura) {
        const stripe = await RecebimentoService.stripeDoTenant(contratante.tenantId)
        if (!stripe) {
            throw new AppError('O pagamento online ainda não foi configurado pelo responsável. Fale com ele.', 400)
        }
        const retorno = urlDoPortal(`/retorno?fatura=${fatura._id}`)
        try {
            const sessao = await stripe.checkout.sessions.create({
                mode: 'payment',
                customer_email: contratante.email,
                client_reference_id: String(fatura._id),
                metadata: { faturaId: String(fatura._id), tenantId: String(contratante.tenantId) },
                line_items: fatura.itens.map((i) => ({
                    quantity: 1,
                    price_data: { currency: fatura.moeda.toLowerCase(), unit_amount: centavos(i.valor), product_data: { name: `${i.descricao} (${fatura.competencia})` } },
                })),
                locale: contratante.idioma === 'en' ? 'en' : 'pt-BR',
                success_url: `${retorno}&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: urlDoPortal(''),
            })
            return { id: sessao.id, url: sessao.url }
        } catch (error) {
            throw new AppError('Não foi possível abrir o pagamento no Stripe: {detalhe}', 502, null, { detalhe: error.message })
        }
    },

    // Pergunta ao gateway (com a chave do programador) se a fatura foi paga. Usado na volta do pagamento,
    // pela rotina a cada 10 minutos e pelo aviso do Mercado Pago. O valor e a moeda precisam bater.
    async sincronizar(fatura) {
        if (fatura.status !== 'aberta' || !fatura.tentativas.length) return fatura

        if (fatura.tentativas.some((t) => t.gateway === 'mercadopago')) {
            const token = await RecebimentoService.tokenMercadoPago(fatura.tenantId)
            if (token) {
                const busca = await mercadoPago(token, 'GET', `/v1/payments/search?external_reference=${encodeURIComponent(`fatura:${fatura._id}`)}&sort=date_created&criteria=desc`)
                const pago = (busca.results ?? []).find((p) => p.status === 'approved'
                    && p.currency_id === 'BRL'
                    && Math.abs(Number(p.transaction_amount) - fatura.total) < 0.005)
                if (pago) return await this.marcarPaga(fatura, { gateway: 'mercadopago', id: String(pago.id), metodo: pago.payment_method_id ?? null })
            }
        }

        const sessoes = fatura.tentativas.filter((t) => t.gateway === 'stripe')
        if (sessoes.length) {
            const stripe = await RecebimentoService.stripeDoTenant(fatura.tenantId)
            if (stripe) {
                for (const t of sessoes) {
                    const sessao = await stripe.checkout.sessions.retrieve(t.id).catch(() => null)
                    if (sessao?.payment_status === 'paid'
                        && sessao.metadata?.faturaId === String(fatura._id)
                        && sessao.currency === fatura.moeda.toLowerCase()
                        && sessao.amount_total === centavos(fatura.total)) {
                        const intent = typeof sessao.payment_intent === 'string' ? sessao.payment_intent : sessao.payment_intent?.id
                        return await this.marcarPaga(fatura, { gateway: 'stripe', id: intent ?? sessao.id, metodo: 'card' })
                    }
                }
            }
        }
        return fatura
    },

    // Atômico: se a volta do pagamento e a rotina chegarem juntas, só uma marca (e só um aviso sai).
    async marcarPaga(fatura, pagamento, { manual = false } = {}) {
        const paga = await FaturaModel.findOneAndUpdate(
            { _id: fatura._id, status: 'aberta' },
            { $set: { status: 'paga', pagaEm: new Date(), pagamento, pagaManual: manual } },
            { new: true }
        )
        if (!paga) return await FaturaModel.findById(fatura._id)

        if (!manual) {
            const contratante = await ContratanteModel.findById(paga.contratanteId, 'nome')
            await AlertaService.notificar(paga.tenantId, 'faturaPaga', { nome: contratante?.nome ?? '', total: paga.total, moeda: paga.moeda })
        }
        return paga
    },

    // Aviso do Mercado Pago: só diz "o pagamento X mudou". A situação real é consultada com a chave do programador.
    async webhookMercadoPago(tenantId, paymentId) {
        const token = await RecebimentoService.tokenMercadoPago(tenantId)
        if (!token || !paymentId) return
        const payment = await mercadoPago(token, 'GET', `/v1/payments/${encodeURIComponent(paymentId)}`)
        const faturaId = String(payment.external_reference ?? '').replace(/^fatura:/, '')
        if (!/^[a-f0-9]{24}$/.test(faturaId)) return
        const fatura = await FaturaModel.findOne({ _id: faturaId, tenantId })
        if (fatura) await this.sincronizar(fatura)
    },

    // Rotina: confere as faturas abertas que já tiveram tentativa de pagamento nos últimos 40 dias.
    async sincronizarAbertas() {
        const desde = new Date(Date.now() - 40 * DIA_MS)
        const abertas = await FaturaModel.find({ status: 'aberta', 'tentativas.0': { $exists: true }, updatedAt: { $gte: desde } })
        for (const fatura of abertas) {
            await this.sincronizar(fatura).catch((error) => console.error('Faturas:', error.message))
        }
    },
}
