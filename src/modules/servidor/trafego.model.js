import mongoose from 'mongoose'

const { ObjectId } = mongoose.Schema.Types

// Acessos por país, somados por hora (só o país e a contagem: o IP de quem acessou não é guardado).
const trafegoSchema = new mongoose.Schema({
    servidorId: { type: ObjectId, ref: 'servidores', required: true },
    hora: { type: Date, required: true },
    pais: { type: String, required: true },
    req: { type: Number, default: 0 },
}, { versionKey: false })

trafegoSchema.index({ servidorId: 1, hora: 1, pais: 1 }, { unique: true })
// Some sozinho depois de 90 dias.
trafegoSchema.index({ hora: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 })

const TrafegoModel = mongoose.models.trafego || mongoose.model('trafego', trafegoSchema)

export default TrafegoModel
