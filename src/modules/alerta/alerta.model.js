import mongoose from 'mongoose'

// Configuração de alertas de cada conta: para onde mandar (Telegram) e o que avisar.
const alertaConfigSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, unique: true },

    telegram: {
        chatId: { type: String, default: null },
        nome: { type: String, default: null },
        conectadoEm: { type: Date, default: null },
    },
    // Código temporário do link "Conectar Telegram" (vale 15 minutos).
    codigoVinculo: { type: String, default: null, index: true },
    codigoExpira: { type: Date, default: null },

    ativos: {
        queda: { type: Boolean, default: true },
        lentidao: { type: Boolean, default: true },
        agente: { type: Boolean, default: true },
        recursos: { type: Boolean, default: true },
        ssl: { type: Boolean, default: true },
        dominio: { type: Boolean, default: true },
        emails: { type: Boolean, default: true },
        seguranca: { type: Boolean, default: true },
        faturas: { type: Boolean, default: true },
    },
    limites: {
        ram: { type: Number, default: 90 },
        disco: { type: Number, default: 90 },
        diasSsl: { type: Number, default: 14 },
        diasDominio: { type: Number, default: 30 },
    },
}, { timestamps: true })

alertaConfigSchema.methods.toJSON = function () {
    const obj = this.toObject()
    delete obj.codigoVinculo
    delete obj.codigoExpira
    return obj
}

const AlertaConfigModel = mongoose.models.alertaconfigs || mongoose.model('alertaconfigs', alertaConfigSchema)

export default AlertaConfigModel
