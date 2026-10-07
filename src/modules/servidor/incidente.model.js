import mongoose from 'mongoose'

// Queda (fora do ar) ou lentidão, do começo ao fim. Sem `fim` = ainda acontecendo.
const incidenteSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    servidorId: { type: mongoose.Schema.Types.ObjectId, ref: 'servidores', required: true },
    tipo: { type: String, enum: ['queda', 'lentidao'], required: true },
    inicio: { type: Date, required: true },
    fim: { type: Date, default: null },
    motivo: { type: String, default: null },
}, { timestamps: true })

incidenteSchema.index({ servidorId: 1, inicio: -1 })

const IncidenteModel = mongoose.models.incidentes || mongoose.model('incidentes', incidenteSchema)

export default IncidenteModel
