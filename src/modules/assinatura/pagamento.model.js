import mongoose from 'mongoose'

// Cada pagamento real: Pix (Mercado Pago, vale um período de acesso) e faturas pagas no cartão (Stripe).
// É a base da receita no painel do super_admin.
const pagamentoSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    assinaturaId: { type: mongoose.Schema.Types.ObjectId, ref: 'assinaturas', required: true },
    planoId: { type: mongoose.Schema.Types.ObjectId, ref: 'planos', default: null },

    metodo: { type: String, enum: ['pix', 'stripe'], required: true },
    // Id do pagamento no Mercado Pago ou da fatura no Stripe.
    gatewayId: { type: String, required: true, unique: true },
    status: {
        type: String,
        enum: ['pendente', 'aprovado', 'cancelado', 'expirado', 'rejeitado'],
        default: 'pendente',
    },

    valor: { type: Number, required: true },
    moeda: { type: String, default: 'BRL' },
    qrCode: { type: String, default: null },
    qrCodeBase64: { type: String, default: null },
    expiraEm: { type: Date, default: null },
    aprovadoEm: { type: Date, default: null },

}, { timestamps: true })

const PagamentoModel = mongoose.models.pagamentos || mongoose.model('pagamentos', pagamentoSchema)

export default PagamentoModel
