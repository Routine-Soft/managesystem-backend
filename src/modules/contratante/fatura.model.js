import mongoose from 'mongoose'

const { ObjectId } = mongoose.Schema.Types

// O vencimento fica ao meio-dia UTC do dia escolhido. A fatura só conta como atrasada quando esse dia
// termina (15 h depois = meia-noite em Brasília), assim o cliente tem o dia inteiro para pagar.
const FIM_DO_DIA_MS = 15 * 60 * 60 * 1000

export function faturaVencida(fatura, agora = new Date()) {
    return fatura.status === 'aberta' && new Date(fatura.vencimento).getTime() + FIM_DO_DIA_MS < agora.getTime()
}

// Fatura mensal do cliente final. O dinheiro vai direto para a conta do programador (Mercado Pago ou Stripe dele).
const faturaSchema = new mongoose.Schema({
    tenantId: { type: ObjectId, ref: 'users', required: true, index: true },
    contratanteId: { type: ObjectId, ref: 'contratantes', required: true, index: true },
    // Mês de referência, "2026-10".
    competencia: { type: String, required: true },
    vencimento: { type: Date, required: true },
    itens: [{ _id: false, descricao: String, valor: Number }],
    total: { type: Number, required: true },
    moeda: { type: String, required: true },

    status: { type: String, enum: ['aberta', 'paga', 'cancelada'], default: 'aberta', index: true },

    // Cada vez que o cliente clica em "Pagar" (preferência do Mercado Pago ou sessão do Stripe).
    tentativas: [{ _id: false, gateway: String, id: String, url: String, em: Date }],
    pagamento: {
        gateway: { type: String, default: null },
        id: { type: String, default: null },
        metodo: { type: String, default: null },
    },
    pagaEm: { type: Date, default: null },
    // Marcada como paga à mão pelo programador (ex.: recebeu por fora).
    pagaManual: { type: Boolean, default: false },

    alertas: { type: mongoose.Schema.Types.Mixed, default: {} },

}, { timestamps: true, minimize: false })

faturaSchema.index({ contratanteId: 1, competencia: 1 }, { unique: true })

faturaSchema.methods.toJSON = function () {
    const obj = this.toObject()
    delete obj.alertas
    obj.tentativas = (obj.tentativas ?? []).map(({ gateway, em }) => ({ gateway, em }))
    obj.vencida = faturaVencida(obj)
    return obj
}

const FaturaModel = mongoose.models.faturas || mongoose.model('faturas', faturaSchema)

export default FaturaModel
