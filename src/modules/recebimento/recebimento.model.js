import mongoose from 'mongoose'

// Contas de recebimento do programador: o cliente dele paga direto nelas (o dinheiro não passa pelo ManageSystem).
// As chaves ficam cifradas (shared/utils/cripto.js) e nunca voltam para a tela; só o final delas.
const contaSchema = {
    chaveCifrada: { type: String, default: null },
    final: { type: String, default: null },
    // Quem é a conta no gateway (apelido/e-mail), para o programador conferir que ligou a conta certa.
    conta: { type: String, default: null },
    contaId: { type: String, default: null },
    conectadoEm: { type: Date, default: null },
}

const recebimentoSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, unique: true },
    mercadoPago: contaSchema,
    stripe: contaSchema,
}, { timestamps: true })

recebimentoSchema.methods.toJSON = function () {
    const obj = this.toObject()
    for (const gateway of ['mercadoPago', 'stripe']) {
        if (obj[gateway]) delete obj[gateway].chaveCifrada
    }
    return obj
}

const RecebimentoModel = mongoose.models.recebimentos || mongoose.model('recebimentos', recebimentoSchema)

export default RecebimentoModel
