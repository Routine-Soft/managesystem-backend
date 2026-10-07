import IncidenteModel from '../servidor/incidente.model.js'
import { AlertaService } from '../alerta/alerta.service.js'

// Abre e fecha quedas e lentidões, muda o status do servidor e avisa no Telegram.
// Usado pela verificação de fora (URL) e pelo sinal do agente (servidores sem URL).

async function incidenteAberto(servidor, tipo) {
    return await IncidenteModel.findOne({ servidorId: servidor._id, tipo, fim: null })
}

function mudarStatus(servidor, status) {
    if (servidor.status !== status) {
        servidor.status = status
        servidor.statusDesde = new Date()
    }
}

export const EstadoService = {
    async marcarQueda(servidor, motivo) {
        mudarStatus(servidor, 'offline')
        if (await incidenteAberto(servidor, 'queda')) return
        // Fora do ar, a lentidão em andamento perde o sentido: fecha.
        await IncidenteModel.updateMany({ servidorId: servidor._id, tipo: 'lentidao', fim: null }, { $set: { fim: new Date() } })
        await IncidenteModel.create({ tenantId: servidor.tenantId, servidorId: servidor._id, tipo: 'queda', inicio: new Date(), motivo })
        await AlertaService.notificar(servidor.tenantId, 'queda', { nome: servidor.nome, motivo })
    },

    async marcarNoAr(servidor, { lento = false } = {}) {
        const queda = await incidenteAberto(servidor, 'queda')
        if (queda) {
            queda.fim = new Date()
            await queda.save()
            await AlertaService.notificar(servidor.tenantId, 'voltou', { nome: servidor.nome, minutos: (queda.fim - queda.inicio) / 60000 })
        }
        mudarStatus(servidor, lento ? 'lento' : 'online')
    },

    async marcarLentidao(servidor, ms) {
        mudarStatus(servidor, 'lento')
        if (await incidenteAberto(servidor, 'lentidao')) return
        await IncidenteModel.create({ tenantId: servidor.tenantId, servidorId: servidor._id, tipo: 'lentidao', inicio: new Date(), motivo: `${ms} ms` })
        await AlertaService.notificar(servidor.tenantId, 'lentidao', { nome: servidor.nome, ms })
    },

    async fecharLentidao(servidor) {
        const lentidao = await incidenteAberto(servidor, 'lentidao')
        if (!lentidao) return
        lentidao.fim = new Date()
        await lentidao.save()
        await AlertaService.notificar(servidor.tenantId, 'lentidaoFim', { nome: servidor.nome })
    },
}
