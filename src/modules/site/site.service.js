import mongoose from 'mongoose'
import SiteModel from './site.model.js'
import ServidorModel from '../servidor/servidor.model.js'
import { AssinaturaService } from '../assinatura/assinatura.service.js'
import { siteDTO } from './site.dto.js'
import { consultarDominio } from '../monitor/checagem.rdap.js'
import { verificarSsl } from '../monitor/checagem.ssl.js'
import { consultarMx } from '../monitor/checagem.dns.js'
import AppError from '../../errors/AppError.js'
import { exigirId } from '../shared/utils/ids.js'

async function buscarDoTenant(tenantId, id) {
    exigirId(id, 'Site não encontrado')
    const site = await SiteModel.findOne({ _id: id, tenantId })
    if (!site) {
        throw new AppError('Site não encontrado', 404)
    }
    return site
}

async function validarServidor(tenantId, servidorId) {
    if (!servidorId) return
    if (!mongoose.isValidObjectId(servidorId) || !(await ServidorModel.exists({ _id: servidorId, tenantId }))) {
        throw new AppError('Servidor não encontrado', 404)
    }
}

function erroDeDominioDuplicado(error) {
    if (error.code === 11000) {
        return new AppError('Este domínio já está cadastrado', 409)
    }
    return error
}

export const SiteService = {
    async listar(tenantId) {
        return await SiteModel.find({ tenantId }).sort({ dominio: 1 })
    },

    async criar(tenantId, body) {
        const dto = siteDTO(body ?? {})
        if (!dto.dominio) {
            throw new AppError('Informe o domínio', 400)
        }
        await validarServidor(tenantId, dto.servidorId)

        const { sites: limite } = await AssinaturaService.limitesDoPlano(tenantId)
        if (limite !== null && (await SiteModel.countDocuments({ tenantId })) >= limite) {
            throw new AppError('Seu plano permite até {limite} sites. Troque de plano para adicionar mais.', 403, 'LIMITE_DO_PLANO', { limite })
        }

        let site
        try {
            site = await SiteModel.create({ ...dto, tenantId })
        } catch (error) {
            throw erroDeDominioDuplicado(error)
        }
        return await this.verificar(site)
    },

    async atualizar(tenantId, id, body) {
        const site = await buscarDoTenant(tenantId, id)
        const dto = siteDTO(body ?? {})
        await validarServidor(tenantId, dto.servidorId)

        const trocouDominio = dto.dominio && dto.dominio !== site.dominio
        if ('dominio' in dto) site.dominio = dto.dominio
        if ('servidorId' in dto) site.servidorId = dto.servidorId
        if (dto.manual) site.manual = dto.manual
        if (dto.emails) Object.assign(site.emails, dto.emails)

        try {
            await site.save()
        } catch (error) {
            throw erroDeDominioDuplicado(error)
        }
        return trocouDominio ? await this.verificar(site) : site
    },

    async remover(tenantId, id) {
        const site = await buscarDoTenant(tenantId, id)
        await site.deleteOne()
        return null
    },

    async verificarAgora(tenantId, id) {
        const site = await buscarDoTenant(tenantId, id)
        return await this.verificar(site)
    },

    // Consulta domínio (RDAP), certificado e MX ao mesmo tempo e grava o resultado.
    async verificar(site) {
        const [registro, ssl, mx] = await Promise.all([
            consultarDominio(site.dominio),
            verificarSsl(site.dominio),
            consultarMx(site.dominio),
        ])
        // Falha temporária do RDAP não apaga as datas que já tínhamos.
        site.registro = registro.erro ? { ...(site.toObject().registro ?? {}), verificadoEm: registro.verificadoEm, erro: registro.erro } : registro
        site.ssl = ssl
        site.emails.mx = mx.mx
        site.emails.provedorDetectado = mx.provedorDetectado
        await site.save()
        return site
    },
}
