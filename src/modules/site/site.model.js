import mongoose from 'mongoose'

const caixaSchema = new mongoose.Schema({
    endereco: { type: String, required: true, lowercase: true, trim: true },
    cotaGB: { type: Number, default: null },
    usadoGB: { type: Number, default: null },
}, { _id: false })

const siteSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    dominio: { type: String, required: true, lowercase: true, trim: true },
    // Servidor onde o site roda (opcional): o domínio aparece no painel dele.
    servidorId: { type: mongoose.Schema.Types.ObjectId, ref: 'servidores', default: null },

    // Automático (RDAP): quando foi registrado e quando vence.
    registro: {
        dominioRegistrado: String,
        criadoEm: Date,
        expiraEm: Date,
        atualizadoEm: Date,
        registrador: String,
        status: [String],
        verificadoEm: Date,
        erro: String,
    },
    // Preenchido à mão: datas (quando o RDAP não informa), onde foi comprado e quanto custa renovar.
    manual: {
        criadoEm: { type: Date, default: null },
        expiraEm: { type: Date, default: null },
        registrador: { type: String, default: null },
        valorRenovacao: { type: Number, default: null },
        moeda: { type: String, default: 'BRL' },
        renovacaoAutomatica: { type: Boolean, default: false },
        observacao: { type: String, default: null },
    },

    ssl: {
        valido: Boolean,
        emissor: String,
        expiraEm: Date,
        verificadoEm: Date,
        erro: String,
    },

    // E-mails corporativos: o provedor é detectado pelo MX; caixas, uso e cobrança são preenchidos à mão.
    emails: {
        mx: [String],
        provedorDetectado: { type: String, default: null },
        provedor: { type: String, default: null },
        vencimento: { type: Date, default: null },
        valor: { type: Number, default: null },
        moeda: { type: String, default: 'BRL' },
        periodicidade: { type: String, enum: ['mensal', 'anual'], default: 'anual' },
        caixas: [caixaSchema],
    },

    alertas: { type: mongoose.Schema.Types.Mixed, default: {} },

}, { timestamps: true, minimize: false })

siteSchema.index({ tenantId: 1, dominio: 1 }, { unique: true })

siteSchema.methods.toJSON = function () {
    const obj = this.toObject()
    delete obj.alertas
    return obj
}

const SiteModel = mongoose.models.sites || mongoose.model('sites', siteSchema)

export default SiteModel
