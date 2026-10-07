import mongoose from 'mongoose'

// Resultado de cada verificação de fora (a API chama a URL do servidor). Apagada depois de 31 dias.
const verificacaoSchema = new mongoose.Schema({
    servidorId: { type: mongoose.Schema.Types.ObjectId, ref: 'servidores', required: true },
    em: { type: Date, required: true },
    ok: Boolean,
    lento: Boolean,
    ms: Number,
    statusHttp: Number,
}, { versionKey: false })

verificacaoSchema.index({ servidorId: 1, em: -1 })
verificacaoSchema.index({ em: 1 }, { expireAfterSeconds: 31 * 24 * 60 * 60 })

const VerificacaoModel = mongoose.models.verificacoes || mongoose.model('verificacoes', verificacaoSchema)

export default VerificacaoModel
