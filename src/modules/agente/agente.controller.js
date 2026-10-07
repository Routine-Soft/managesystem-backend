import fs from 'node:fs'
import { AgenteService } from './agente.service.js'
import { ARQUIVO_DO_AGENTE, ARQUIVO_DE_INSTALACAO, VERSAO_DO_AGENTE } from './agente.versao.js'
import { urlPublicaDaApi } from '../servidor/servidor.token.js'

export const AgenteController = {
    async coleta(req, reply) {
        const servidor = await AgenteService.autenticar(req.headers.authorization)
        const data = await AgenteService.coleta(servidor, req.body, req.ip)
        return reply.send({ success: true, data })
    },

    async inventario(req, reply) {
        const servidor = await AgenteService.autenticar(req.headers.authorization)
        const data = await AgenteService.inventario(servidor, req.body)
        return reply.send({ success: true, data })
    },

    // Script de instalação com o endereço desta API já preenchido.
    async instalador(req, reply) {
        const script = fs.readFileSync(ARQUIVO_DE_INSTALACAO, 'utf8').replaceAll('__API_URL__', urlPublicaDaApi())
        return reply.type('text/x-shellscript; charset=utf-8').send(script)
    },

    async codigo(req, reply) {
        return reply.type('text/javascript; charset=utf-8').send(fs.readFileSync(ARQUIVO_DO_AGENTE, 'utf8'))
    },

    async versao(req, reply) {
        return reply.send({ success: true, data: { versao: VERSAO_DO_AGENTE } })
    },
}
