import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'
import AssinaturaModel from './assinatura.model.js'
import PagamentoModel from './pagamento.model.js'
import PlanoModel from '../plano/plano.model.js'
import UserModel from '../user/user.model.js'
import { interpretarDocumento } from './documento.js'
import { avaliarAcesso, DIA_EM_MS } from './assinatura.acesso.js'
import { aplicarStatusStripe, precoDaAssinatura } from './assinatura.stripe.js'
import { getStripe, stripeConfigurado } from '../../config/stripe.js'
import { MP_API, mercadoPagoConfigurado } from '../../config/mercadopago.js'
import AppError from '../../errors/AppError.js'

// Pix avulso: quanto tempo o QR Code vale e quantos dias de acesso cada pagamento libera.
export const PIX_VALIDADE_MINUTOS = 60
export const PIX_DIAS_DE_ACESSO = 30

// Frontend usa HashRouter: as rotas de retorno ficam depois do "#".
function urlDoApp(rota) {
    const base = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '')
    return `${base}/#${rota}`
}

function exigirStripe() {
    if (!stripeConfigurado()) {
        throw new AppError('Pagamento com cartão ainda não está configurado. Fale com o suporte.', 503)
    }
}

function exigirMercadoPago() {
    if (!mercadoPagoConfigurado()) {
        throw new AppError('Pagamento por Pix ainda não está configurado. Fale com o suporte.', 503)
    }
}

function traduzirErroStripe(error) {
    const mensagem = error?.message ?? 'erro desconhecido'
    if (error?.code === 'resource_missing' && mensagem.includes('price')) {
        return new AppError('O preço deste plano não foi encontrado no Stripe. Confira o "ID do preço" do plano.', 502)
    }
    return new AppError('Não foi possível falar com o Stripe: {detalhe}', 502, null, { detalhe: mensagem })
}

// ----- Mercado Pago (Pix) -----

async function chamarMercadoPago(metodo, caminho, { corpo, idempotencyKey } = {}) {
    const resposta = await fetch(`${MP_API}${caminho}`, {
        method: metodo,
        headers: {
            Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
        },
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

// O Mercado Pago quer a expiração com fuso, no formato 2026-09-28T10:00:00.000-03:00 (horário de Brasília).
function expiracaoComFuso(data) {
    return new Date(data.getTime() - 3 * 60 * 60 * 1000).toISOString().replace('Z', '-03:00')
}

// Situação do Pix no Mercado Pago -> situação interna. QR Code vencido chega como "cancelled" com detalhe "expired".
function situacaoDoPix(payment) {
    switch (payment.status) {
        case 'approved':
            return 'aprovado'
        case 'rejected':
            return 'rejeitado'
        case 'cancelled':
            return payment.status_detail === 'expired' ? 'expirado' : 'cancelado'
        default:
            return 'pendente'
    }
}

function pagamentoParaDTO(pagamento) {
    if (!pagamento) return null
    return {
        id: pagamento._id,
        metodo: pagamento.metodo,
        status: pagamento.status,
        valor: pagamento.valor,
        moeda: pagamento.moeda,
        qrCode: pagamento.qrCode,
        qrCodeBase64: pagamento.qrCodeBase64,
        expiraEm: pagamento.expiraEm,
        aprovadoEm: pagamento.aprovadoEm,
        planoId: pagamento.planoId,
    }
}

// Checkout que nunca foi pago: a conta volta ao teste se ainda houver prazo, senão fica expirada.
function voltarAoGratuito(assinatura) {
    const testeVigente = !!assinatura.dataFimTrial && assinatura.dataFimTrial > new Date()
    assinatura.status = testeVigente ? 'trial' : 'expirada'
    assinatura.inadimplenteDesde = null
    return assinatura
}

async function planoDoPrecoStripe(sub) {
    const planoId = sub?.metadata?.planoId
    if (planoId && mongoose.isValidObjectId(planoId)) {
        const plano = await PlanoModel.findById(planoId)
        if (plano) return plano
    }
    const priceId = precoDaAssinatura(sub)
    return priceId ? await PlanoModel.findOne({ stripePriceId: priceId }) : null
}

export const AssinaturaService = {

    async criarAssinaturaTrial(tenantId) {
        const planoGratis = await PlanoModel.findOne({ tipo: 'gratis', ativo: true })
        if (!planoGratis) {
            throw new AppError('Plano gratuito não configurado', 500)
        }

        const dataInicio = new Date()
        const dataFimTrial = new Date(dataInicio.getTime() + (planoGratis.duracaoDiasTrial || 15) * DIA_EM_MS)

        return await AssinaturaModel.create({ tenantId, planoId: planoGratis._id, status: 'trial', dataInicio, dataFimTrial })
    },

    async obterAssinaturaAtual(tenantId) {
        let assinatura = await AssinaturaModel.findOne({ tenantId }).sort({ createdAt: -1 }).populate('planoId')

        // Conta sem registro de assinatura: recria como "expirada" (sem novo teste) para ela conseguir assinar.
        if (!assinatura) {
            const planoGratis = await PlanoModel.findOne({ tipo: 'gratis' })
            if (!planoGratis) {
                throw new AppError('Plano gratuito não configurado', 500)
            }
            const agora = new Date()
            await AssinaturaModel.create({ tenantId, planoId: planoGratis._id, status: 'expirada', dataInicio: agora, dataFimTrial: agora })
            assinatura = await AssinaturaModel.findOne({ tenantId }).sort({ createdAt: -1 }).populate('planoId')
        }

        const agora = new Date()
        const vencidoTrial = assinatura.status === 'trial' && assinatura.dataFimTrial && assinatura.dataFimTrial < agora
        const vencidoPix = assinatura.status === 'ativa' && ['pix', 'manual'].includes(assinatura.cobranca) && assinatura.proximaCobranca && assinatura.proximaCobranca < agora
        if (vencidoTrial || vencidoPix) {
            assinatura.status = 'expirada'
            await assinatura.save()
        }

        return assinatura
    },

    // A conta do dono do sistema (super_admin) não tem assinatura e nunca é bloqueada: seus servidores
    // são monitorados e seus agentes aceitos normalmente.
    async verificarAcesso(tenantId) {
        if (await UserModel.exists({ _id: tenantId, role: 'super_admin' })) {
            return { liberado: true, motivo: null, ate: null }
        }
        const assinatura = await AssinaturaModel.findOne({ tenantId }).sort({ createdAt: -1 })
        return avaliarAcesso(assinatura)
    },

    // Limites do plano atual (null = sem limite).
    async limitesDoPlano(tenantId) {
        const assinatura = await AssinaturaModel.findOne({ tenantId }).sort({ createdAt: -1 }).populate('planoId')
        return {
            servidores: assinatura?.planoId?.limiteServidores ?? null,
            sites: assinatura?.planoId?.limiteSites ?? null,
        }
    },

    async escolherPlanoPago(planoId) {
        const plano = mongoose.isValidObjectId(planoId)
            ? await PlanoModel.findOne({ _id: planoId, tipo: 'pago', ativo: true })
            : null
        if (!plano) {
            throw new AppError('Plano não encontrado ou indisponível para assinatura', 404)
        }
        return plano
    },

    // ===================== Stripe (cartão, todos os países) =====================

    async iniciarCheckoutStripe(tenantId, planoId, idioma) {
        exigirStripe()
        const admin = await UserModel.findById(tenantId)
        if (!admin) {
            throw new AppError('Conta não encontrada', 404)
        }

        const assinatura = await this.obterAssinaturaAtual(tenantId)
        if (assinatura.status === 'ativa' && assinatura.cobranca === 'stripe') {
            throw new AppError('Você já tem uma assinatura ativa no cartão. Para trocar de plano ou de cartão, use "Gerenciar no Stripe".', 409)
        }
        if (assinatura.status === 'ativa' && ['pix', 'manual'].includes(assinatura.cobranca)) {
            throw new AppError('Seu período pago por Pix ainda está valendo (até {data}). Assine no cartão depois dessa data.', 409, null, { data: assinatura.proximaCobranca })
        }

        const plano = await this.escolherPlanoPago(planoId)
        if (!plano.stripePriceId) {
            throw new AppError('Este plano ainda não está disponível no cartão.', 400)
        }

        const stripe = getStripe()
        try {
            if (!assinatura.stripeCustomerId) {
                const cliente = await stripe.customers.create({
                    email: admin.email,
                    name: admin.nomeEmpresa,
                    metadata: { tenantId: String(tenantId) },
                })
                assinatura.stripeCustomerId = cliente.id
                await assinatura.save()
            }

            const sessao = await stripe.checkout.sessions.create({
                mode: 'subscription',
                customer: assinatura.stripeCustomerId,
                client_reference_id: String(tenantId),
                line_items: [{ price: plano.stripePriceId, quantity: 1 }],
                subscription_data: { metadata: { tenantId: String(tenantId), planoId: String(plano._id) } },
                locale: idioma === 'en' ? 'en' : 'pt-BR',
                allow_promotion_codes: true,
                success_url: `${urlDoApp('/assinatura/retorno')}?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: urlDoApp('/assinatura'),
            })
            return { url: sessao.url }
        } catch (error) {
            throw traduzirErroStripe(error)
        }
    },

    // Portal do Stripe: trocar cartão, ver faturas, cancelar ou trocar de plano.
    async abrirPortalStripe(tenantId, idioma) {
        exigirStripe()
        const assinatura = await this.obterAssinaturaAtual(tenantId)
        if (!assinatura.stripeCustomerId) {
            throw new AppError('Você ainda não tem assinatura no cartão.', 400)
        }
        try {
            const sessao = await getStripe().billingPortal.sessions.create({
                customer: assinatura.stripeCustomerId,
                locale: idioma === 'en' ? 'en' : 'pt-BR',
                return_url: urlDoApp('/assinatura'),
            })
            return { url: sessao.url }
        } catch (error) {
            throw traduzirErroStripe(error)
        }
    },

    // Aplica uma assinatura do Stripe à assinatura local. O tenant vem do banco (cliente do Stripe), nunca do navegador.
    async aplicarSubscriptionStripe(sub) {
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
        let assinatura = await AssinaturaModel.findOne({ stripeSubscriptionId: sub.id })
            ?? await AssinaturaModel.findOne({ stripeCustomerId: customerId }).sort({ createdAt: -1 })
        if (!assinatura && mongoose.isValidObjectId(sub.metadata?.tenantId)) {
            assinatura = await AssinaturaModel.findOne({ tenantId: sub.metadata.tenantId }).sort({ createdAt: -1 })
        }
        if (!assinatura) return null

        // Uma assinatura antiga cancelada não mexe numa assinatura nova da mesma conta.
        if (assinatura.stripeSubscriptionId && assinatura.stripeSubscriptionId !== sub.id && sub.status === 'canceled') {
            return assinatura
        }

        aplicarStatusStripe(assinatura, sub, voltarAoGratuito)

        if (['ativa', 'cancelada', 'inadimplente'].includes(assinatura.status)) {
            const plano = await planoDoPrecoStripe(sub)
            if (plano) assinatura.planoId = plano._id
        } else if (['trial', 'expirada'].includes(assinatura.status)) {
            const gratis = await PlanoModel.findOne({ tipo: 'gratis' })
            if (gratis) assinatura.planoId = gratis._id
        }

        await assinatura.save()
        return assinatura
    },

    // Volta do checkout: confere a sessão no Stripe e aplica a assinatura sem esperar o webhook.
    async sincronizarStripe(tenantId, sessionId) {
        exigirStripe()
        const stripe = getStripe()
        const assinatura = await this.obterAssinaturaAtual(tenantId)

        try {
            let subId = assinatura.stripeSubscriptionId
            if (sessionId) {
                const sessao = await stripe.checkout.sessions.retrieve(String(sessionId))
                if (sessao.client_reference_id !== String(tenantId)) {
                    throw new AppError('Este pagamento não pertence à sua conta', 403)
                }
                subId = typeof sessao.subscription === 'string' ? sessao.subscription : sessao.subscription?.id
            }
            if (subId) {
                await this.aplicarSubscriptionStripe(await stripe.subscriptions.retrieve(subId))
            }
        } catch (error) {
            if (error instanceof AppError) throw error
            throw traduzirErroStripe(error)
        }

        return await this.obterAssinaturaAtual(tenantId)
    },

    async registrarFaturaStripe(fatura, status) {
        const customerId = typeof fatura.customer === 'string' ? fatura.customer : fatura.customer?.id
        const assinatura = await AssinaturaModel.findOne({ stripeCustomerId: customerId }).sort({ createdAt: -1 })
        if (!assinatura) return

        if (status === 'aprovado') {
            // O Stripe pode reenviar o mesmo aviso; o upsert por gatewayId conta cada fatura uma vez só.
            await PagamentoModel.findOneAndUpdate(
                { gatewayId: fatura.id },
                {
                    $setOnInsert: {
                        tenantId: assinatura.tenantId,
                        assinaturaId: assinatura._id,
                        planoId: assinatura.planoId,
                        metodo: 'stripe',
                        status: 'aprovado',
                        valor: (fatura.amount_paid ?? 0) / 100,
                        moeda: String(fatura.currency ?? 'brl').toUpperCase(),
                        aprovadoEm: new Date(),
                    },
                },
                { upsert: true }
            )
        } else if (assinatura.status === 'ativa') {
            assinatura.status = 'inadimplente'
            assinatura.inadimplenteDesde = new Date()
            await assinatura.save()
        }
    },

    async processarEventoStripe(evento) {
        const objeto = evento.data?.object
        switch (evento.type) {
            case 'checkout.session.completed': {
                if (objeto.mode !== 'subscription' || !objeto.subscription) return
                const tenantId = objeto.client_reference_id
                if (mongoose.isValidObjectId(tenantId) && objeto.customer) {
                    await AssinaturaModel.findOneAndUpdate(
                        { tenantId },
                        { $set: { stripeCustomerId: objeto.customer } },
                        { sort: { createdAt: -1 } }
                    )
                }
                const subId = typeof objeto.subscription === 'string' ? objeto.subscription : objeto.subscription.id
                await this.aplicarSubscriptionStripe(await getStripe().subscriptions.retrieve(subId))
                return
            }
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted':
                await this.aplicarSubscriptionStripe(objeto)
                return
            case 'invoice.paid':
                await this.registrarFaturaStripe(objeto, 'aprovado')
                return
            case 'invoice.payment_failed':
                await this.registrarFaturaStripe(objeto, 'falhou')
                return
            default:
                return
        }
    },

    // ===================== Mercado Pago (Pix, só Brasil) =====================

    async iniciarPagamentoPix(tenantId, planoId, documento) {
        exigirMercadoPago()
        const admin = await UserModel.findById(tenantId)
        if (!admin) {
            throw new AppError('Conta não encontrada', 404)
        }

        const pagador = interpretarDocumento(documento)
        if (!pagador) {
            throw new AppError('Informe um CPF ou CNPJ válido de quem vai pagar o Pix', 400)
        }

        await this.confirmarPixPendente(tenantId).catch(() => null)
        const assinatura = await this.obterAssinaturaAtual(tenantId)

        if (assinatura.cobranca === 'stripe' && ['ativa', 'inadimplente'].includes(assinatura.status)) {
            throw new AppError('Sua assinatura no cartão está ativa e renova sozinha. Para pagar por Pix, cancele a assinatura no cartão antes.', 409)
        }

        const plano = await this.escolherPlanoPago(planoId)
        if (!plano.precoBRL) {
            throw new AppError('Este plano não tem preço em reais para pagamento por Pix.', 400)
        }
        if (assinatura.status === 'ativa' && String(assinatura.planoId?._id ?? assinatura.planoId) !== String(plano._id)) {
            throw new AppError('Para trocar de plano, aguarde o fim do período já pago. Por enquanto você pode renovar o plano atual.', 409)
        }

        // Só um Pix pendente por conta: os anteriores são cancelados.
        const antigos = await PagamentoModel.find({ tenantId, metodo: 'pix', status: 'pendente' })
        for (const antigo of antigos) {
            await chamarMercadoPago('PUT', `/v1/payments/${antigo.gatewayId}`, { corpo: { status: 'cancelled' } }).catch(() => null)
            antigo.status = 'cancelado'
            await antigo.save()
        }

        const expiraEm = new Date(Date.now() + PIX_VALIDADE_MINUTOS * 60 * 1000)
        const corpo = {
            transaction_amount: plano.precoBRL,
            description: `ManageSystem - ${plano.nome} (${PIX_DIAS_DE_ACESSO} dias)`,
            payment_method_id: 'pix',
            date_of_expiration: expiracaoComFuso(expiraEm),
            external_reference: assinatura._id.toString(),
            payer: {
                // No ambiente de teste o pagador precisa ser um usuário de teste; em produção MP_TEST_PAYER_EMAIL fica vazio.
                email: process.env.MP_TEST_PAYER_EMAIL || admin.email,
                identification: { type: pagador.tipo, number: pagador.numero },
            },
        }
        if (process.env.APP_URL_BACKEND) {
            corpo.notification_url = `${process.env.APP_URL_BACKEND.replace(/\/+$/, '')}/api/assinaturas/mercadopago/webhook`
        }

        let payment
        try {
            payment = await chamarMercadoPago('POST', '/v1/payments', { corpo, idempotencyKey: randomUUID() })
        } catch (error) {
            throw new AppError('Não foi possível gerar o Pix no Mercado Pago: {detalhe}', 502, null, { detalhe: error.message })
        }

        const dados = payment.point_of_interaction?.transaction_data
        if (!dados?.qr_code) {
            await chamarMercadoPago('PUT', `/v1/payments/${payment.id}`, { corpo: { status: 'cancelled' } }).catch(() => null)
            throw new AppError('O Mercado Pago não devolveu o QR Code do Pix. Verifique se a conta tem uma chave Pix cadastrada.', 502)
        }

        const pagamento = await PagamentoModel.create({
            tenantId,
            assinaturaId: assinatura._id,
            planoId: plano._id,
            metodo: 'pix',
            gatewayId: String(payment.id),
            valor: plano.precoBRL,
            moeda: 'BRL',
            qrCode: dados.qr_code,
            qrCodeBase64: dados.qr_code_base64 ?? null,
            expiraEm: payment.date_of_expiration ? new Date(payment.date_of_expiration) : expiraEm,
        })

        return pagamentoParaDTO(pagamento)
    },

    // Pergunta ao Mercado Pago pelo Pix pendente (o id vem do banco, nunca do cliente). Assim quem paga e fecha a
    // janela é liberado mesmo que o aviso (webhook) não chegue.
    async confirmarPixPendente(tenantId) {
        if (!mercadoPagoConfigurado()) return
        const pendente = await PagamentoModel.findOne({ tenantId, metodo: 'pix', status: 'pendente' }).sort({ createdAt: -1 })
        if (!pendente) return

        const payment = await chamarMercadoPago('GET', `/v1/payments/${pendente.gatewayId}`)
        await this.aplicarPagamentoPix(pendente, payment)

        const atualizado = await PagamentoModel.findById(pendente._id)
        if (atualizado.status === 'pendente' && atualizado.expiraEm && atualizado.expiraEm < new Date()) {
            atualizado.status = 'expirado'
            await atualizado.save()
        }
    },

    async sincronizarPix(tenantId) {
        await this.confirmarPixPendente(tenantId)
        const ultimo = await PagamentoModel.findOne({ tenantId, metodo: 'pix' }).sort({ createdAt: -1 })
        const assinatura = await this.obterAssinaturaAtual(tenantId)
        return { pagamento: pagamentoParaDTO(ultimo), assinatura }
    },

    async aplicarPagamentoPix(pagamento, payment) {
        const situacao = situacaoDoPix(payment)

        if (situacao !== 'aprovado') {
            if (pagamento.status === 'pendente' && situacao !== 'pendente') {
                pagamento.status = situacao
                await pagamento.save()
            }
            return pagamento
        }

        // Só libera se o valor pago é o valor cobrado.
        if (Math.abs(Number(payment.transaction_amount) - pagamento.valor) > 0.005) return pagamento

        // Atômico: mesmo que webhook e consulta cheguem juntos, só um deles estende o acesso.
        const aprovado = await PagamentoModel.findOneAndUpdate(
            { _id: pagamento._id, status: { $ne: 'aprovado' } },
            { $set: { status: 'aprovado', aprovadoEm: new Date() } },
            { new: true }
        )
        if (!aprovado) return pagamento

        await this.liberarAcessoPix(aprovado)
        return aprovado
    },

    // Estende o acesso em PIX_DIAS_DE_ACESSO dias, somando ao que ainda restar do período já pago.
    async liberarAcessoPix(pagamento) {
        const assinatura = await AssinaturaModel.findById(pagamento.assinaturaId)
        if (!assinatura) return

        const agora = new Date()
        const temPeriodoPago = (assinatura.status === 'ativa' && ['pix', 'manual'].includes(assinatura.cobranca)) || assinatura.status === 'cancelada'
        const base = temPeriodoPago && assinatura.proximaCobranca && assinatura.proximaCobranca > agora ? assinatura.proximaCobranca : agora

        assinatura.planoId = pagamento.planoId
        assinatura.status = 'ativa'
        assinatura.cobranca = 'pix'
        assinatura.inadimplenteDesde = null
        assinatura.proximaCobranca = new Date(base.getTime() + PIX_DIAS_DE_ACESSO * DIA_EM_MS)
        await assinatura.save()
    },

    async processarWebhookMercadoPago(paymentId) {
        const payment = await chamarMercadoPago('GET', `/v1/payments/${paymentId}`)
        if (payment.payment_method_id !== 'pix') return
        const pagamento = await PagamentoModel.findOne({ metodo: 'pix', gatewayId: String(payment.id) })
        if (pagamento) await this.aplicarPagamentoPix(pagamento, payment)
    },

    async historicoDePagamentos(tenantId) {
        const pagamentos = await PagamentoModel.find({ tenantId, status: 'aprovado' }).sort({ aprovadoEm: -1 }).limit(50).populate('planoId', 'nome')
        return pagamentos.map((p) => ({ ...pagamentoParaDTO(p), plano: p.planoId?.nome ?? null, qrCode: undefined, qrCodeBase64: undefined }))
    },
}
