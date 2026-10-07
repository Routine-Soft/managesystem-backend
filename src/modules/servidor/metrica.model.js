import mongoose from 'mongoose'

// Uma leitura por minuto, mandada pelo agente. Apagada sozinha depois de 31 dias (índice TTL).
const metricaSchema = new mongoose.Schema({
    servidorId: { type: mongoose.Schema.Types.ObjectId, ref: 'servidores', required: true },
    em: { type: Date, required: true },
    cpu: Number,
    load1: Number,
    ramUsada: Number,
    ramTotal: Number,
    discoPct: Number,
    // Requisições no Nginx desde a leitura anterior.
    req: { type: Number, default: 0 },
    req4xx: { type: Number, default: 0 },
    req5xx: { type: Number, default: 0 },
    erros: { type: Number, default: 0 },
}, { versionKey: false })

metricaSchema.index({ servidorId: 1, em: -1 })
metricaSchema.index({ em: 1 }, { expireAfterSeconds: 31 * 24 * 60 * 60 })

const MetricaModel = mongoose.models.metricas || mongoose.model('metricas', metricaSchema)

export default MetricaModel
