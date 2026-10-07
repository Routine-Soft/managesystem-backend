import mongoose from 'mongoose'

// Histórico de atualizações do servidor: pacotes do sistema, deploys (commit novo), renovação de SSL,
// versão nova de programas e dependências.
const eventoSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    servidorId: { type: mongoose.Schema.Types.ObjectId, ref: 'servidores', required: true },
    em: { type: Date, required: true },
    tipo: { type: String, enum: ['sistema', 'deploy', 'automatico', 'dependencia', 'agente'], required: true },
    titulo: { type: String, required: true },
    detalhe: { type: String, default: null },
    // Identifica o evento para não registrar o mesmo duas vezes.
    chave: { type: String, required: true },
}, { versionKey: false })

eventoSchema.index({ servidorId: 1, chave: 1 }, { unique: true })
eventoSchema.index({ servidorId: 1, em: -1 })

const EventoModel = mongoose.models.eventos || mongoose.model('eventos', eventoSchema)

export default EventoModel
