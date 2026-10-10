import mongoose from 'mongoose'

const assinaturaSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    planoId: { type: mongoose.Schema.Types.ObjectId, ref: 'planos', required: true },

    status: {
        type: String,
        enum: ['trial', 'pendente', 'ativa', 'inadimplente', 'cancelada', 'expirada'],
        default: 'trial',
    },

    dataInicio: { type: Date, default: Date.now },
    dataFimTrial: { type: Date, default: null },
    // stripe: cartão internacional, renova sozinho. recorrente: cartão no Mercado Pago (Brasil), renova sozinho.
    // pix: pagamento avulso pelo Mercado Pago, vale até proximaCobranca. manual: liberada pelo super_admin.
    cobranca: { type: String, enum: ['stripe', 'recorrente', 'pix', 'manual'], default: 'stripe' },
    mercadoPagoPreapprovalId: { type: String, default: null, index: true },
    // Troca do Pix para o cartão: a assinatura no cartão só começa a cobrar quando o período do Pix acaba.
    cartaoAgendadoPreapprovalId: { type: String, default: null },
    stripeCustomerId: { type: String, default: null, index: true },
    stripeSubscriptionId: { type: String, default: null, index: true },
    proximaCobranca: { type: Date, default: null },
    inadimplenteDesde: { type: Date, default: null },

    // Bloqueio manual do suporte, independente do status.
    acessoRevogado: { type: Boolean, default: false },

}, { timestamps: true })

const AssinaturaModel = mongoose.models.assinaturas || mongoose.model('assinaturas', assinaturaSchema)

export default AssinaturaModel
