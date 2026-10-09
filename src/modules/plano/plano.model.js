import mongoose from 'mongoose'

const planoSchema = new mongoose.Schema({
    nome: { type: String, required: true, trim: true },
    descricao: { type: String, default: '' },
    tipo: { type: String, enum: ['gratis', 'pago'], required: true },

    // Preço mensal sempre em dólar. Quem é do Brasil paga em Pix o valor convertido pela cotação do dia;
    // quem é de fora paga no cartão pelo preço cadastrado no Stripe (stripePriceId, em dólar).
    precoUSD: { type: Number, default: 0 },
    stripePriceId: { type: String, default: null },

    duracaoDiasTrial: { type: Number, default: null },
    // null = sem limite.
    limiteServidores: { type: Number, default: null },
    limiteSites: { type: Number, default: null },
    ativo: { type: Boolean, default: true },

}, { timestamps: true })

const PlanoModel = mongoose.models.planos || mongoose.model('planos', planoSchema)

export default PlanoModel
