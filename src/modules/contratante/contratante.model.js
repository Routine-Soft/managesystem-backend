import mongoose from 'mongoose'

const { ObjectId } = mongoose.Schema.Types

// Cliente final do programador (dono do site/sistema). Não é um usuário do painel: tem login próprio no
// portal, só enxerga os servidores e sites ligados a ele e paga as próprias faturas.
const itemSchema = new mongoose.Schema({
    descricao: { type: String, required: true },
    valor: { type: Number, required: true },
}, { _id: false })

const contratanteSchema = new mongoose.Schema({
    // Conta do programador dono deste cliente.
    tenantId: { type: ObjectId, ref: 'users', required: true, index: true },
    nome: { type: String, required: true, trim: true },
    email: {
        type: String,
        required: true,
        lowercase: true,
        set: (valor) => (typeof valor === 'string' ? valor.replace(/\s+/g, '') : valor),
    },
    // País decide o meio de pagamento (Brasil = Mercado Pago, outros = Stripe).
    pais: { type: String, default: 'BR' },
    idioma: { type: String, enum: ['pt', 'en'], default: 'pt' },

    // null até o cliente abrir o link de acesso e criar a senha.
    password: { type: String, default: null },
    tokenRefresh: { type: String, default: null },
    // Link de acesso (criar ou trocar a senha): no banco fica só o hash.
    conviteHash: { type: String, default: null, index: true },
    conviteExpira: { type: Date, default: null },
    ultimoAcesso: { type: Date, default: null },

    servidores: [{ type: ObjectId, ref: 'servidores' }],
    sites: [{ type: ObjectId, ref: 'sites' }],

    // Mensalidade (servidor, manutenção...). A fatura do mês é gerada sozinha alguns dias antes do vencimento.
    cobranca: {
        ativa: { type: Boolean, default: false },
        ativadaEm: { type: Date, default: null },
        moeda: { type: String, default: 'BRL' },
        diaVencimento: { type: Number, default: 10 },
        itens: [itemSchema],
    },

    // Telegram do próprio cliente: recebe lembrete de fatura, domínio e e-mails.
    telegram: {
        chatId: { type: String, default: null },
        nome: { type: String, default: null },
        conectadoEm: { type: Date, default: null },
    },
    codigoVinculo: { type: String, default: null, index: true },
    codigoExpira: { type: Date, default: null },

    alertas: { type: mongoose.Schema.Types.Mixed, default: {} },

}, { timestamps: true, minimize: false })

contratanteSchema.index({ tenantId: 1, email: 1 }, { unique: true })

contratanteSchema.methods.toJSON = function () {
    const obj = this.toObject()
    obj.acessoCriado = !!obj.password
    delete obj.password
    delete obj.tokenRefresh
    delete obj.conviteHash
    delete obj.codigoVinculo
    delete obj.codigoExpira
    delete obj.alertas
    return obj
}

const ContratanteModel = mongoose.models.contratantes || mongoose.model('contratantes', contratanteSchema)

export default ContratanteModel
