import ServidorModel from '../servidor/servidor.model.js'
import MetricaModel from '../servidor/metrica.model.js'
import EventoModel from '../servidor/evento.model.js'
import { hashDoToken } from '../servidor/servidor.token.js'
import { categoriaDoPacote, saltoDeVersao } from '../servidor/dependencia.utils.js'
import { AssinaturaService } from '../assinatura/assinatura.service.js'
import { AlertaService } from '../alerta/alerta.service.js'
import { EstadoService } from '../monitor/estado.service.js'
import { coletaDTO, inventarioDTO } from './agente.dto.js'
import { VERSAO_DO_AGENTE } from './agente.versao.js'
import AppError from '../../errors/AppError.js'

const MAX_LOGS = 100
const INTERVALO_ALERTA_RECURSO_MS = 6 * 60 * 60 * 1000
const ORDEM_SEVERIDADE = ['info', 'low', 'moderate', 'high', 'critical']

// Acesso da conta guardado por 5 minutos (o agente chama a cada minuto; não precisa ir ao banco toda vez).
const cacheDeAcesso = new Map()

async function contaLiberada(tenantId) {
    const chave = String(tenantId)
    const guardado = cacheDeAcesso.get(chave)
    if (guardado && guardado.ate > Date.now()) return guardado.liberado
    const { liberado } = await AssinaturaService.verificarAcesso(tenantId)
    cacheDeAcesso.set(chave, { liberado, ate: Date.now() + 5 * 60 * 1000 })
    return liberado
}

function resposta(servidor) {
    return { inventarioPendente: !!servidor.agente?.inventarioPendente, versaoAgente: VERSAO_DO_AGENTE, intervalo: 60 }
}

async function registrarEventos(eventos) {
    if (!eventos.length) return
    // Eventos repetidos (mesma chave) são ignorados pelo índice único.
    await EventoModel.insertMany(eventos, { ordered: false }).catch((error) => {
        if (error.code !== 11000 && !error.writeErrors) throw error
    })
}

// Lê só propriedades do próprio objeto (nomes como "constructor" vindos do agente não pegam nada do protótipo).
function proprio(objeto, chave) {
    return Object.hasOwn(objeto, chave) ? objeto[chave] : undefined
}

// "nome@versao" -> [nome, versao]. Pacotes com escopo começam com "@" (ex.: @fastify/cors@11.0.0).
function separarPacote(texto) {
    const i = texto.lastIndexOf('@')
    return i > 0 ? [texto.slice(0, i), texto.slice(i + 1)] : [texto, '']
}

export const AgenteService = {
    async autenticar(authorization) {
        const token = String(authorization ?? '').replace(/^Bearer\s+/i, '')
        if (!token.startsWith('msa_')) {
            throw new AppError('Token do agente inválido', 401)
        }
        const servidor = await ServidorModel.findOne({ tokenHash: hashDoToken(token) })
        if (!servidor) {
            throw new AppError('Token do agente inválido', 401)
        }
        if (!(await contaLiberada(servidor.tenantId))) {
            throw new AppError('A assinatura desta conta não está ativa', 402, 'ASSINATURA_INATIVA')
        }
        return servidor
    },

    // Leitura de cada minuto: CPU, RAM, disco, requisições e erros.
    async coleta(servidor, body, ip) {
        const c = coletaDTO(body)
        const agora = new Date()

        const voltouDoSilencio = !!servidor.alertas?.agenteSemContato
        servidor.agente.ultimoContato = agora
        servidor.agente.versao = c.versao
        servidor.agente.ip = ip
        if (c.uptime !== null) servidor.sistema.bootEm = new Date(agora.getTime() - c.uptime * 1000)
        servidor.atual = { em: agora, cpu: c.cpu, load1: c.load1, ramTotal: c.ramTotal, ramUsada: c.ramUsada, discoTotal: c.discoTotal, discoUsado: c.discoUsado }

        if (c.logs.length) {
            servidor.logs = [...c.logs.reverse(), ...(servidor.logs ?? [])].slice(0, MAX_LOGS)
        }

        // Sem URL, o sinal do agente é o que diz se o servidor está no ar.
        if (!servidor.url) {
            await EstadoService.marcarNoAr(servidor)
        } else if (servidor.status === 'aguardando') {
            servidor.status = 'online'
            servidor.statusDesde = agora
        }

        if (voltouDoSilencio) {
            servidor.alertas = { ...servidor.alertas, agenteSemContato: null }
            if (servidor.url) await AlertaService.notificar(servidor.tenantId, 'agenteVoltou', { nome: servidor.nome })
        }

        await this.alertarRecursos(servidor, c)
        servidor.markModified('alertas')
        await servidor.save()

        const discoPct = c.discoTotal ? (c.discoUsado / c.discoTotal) * 100 : null
        await MetricaModel.create({
            servidorId: servidor._id,
            em: agora,
            cpu: c.cpu,
            load1: c.load1,
            ramUsada: c.ramUsada,
            ramTotal: c.ramTotal,
            discoPct,
            req: c.req,
            req4xx: c.req4xx,
            req5xx: c.req5xx,
            erros: c.erros,
        })

        return resposta(servidor)
    },

    // RAM ou disco acima do limite: avisa, e só repete depois de 6 horas.
    async alertarRecursos(servidor, c) {
        const limites = await AlertaService.limitesDoTenant(servidor.tenantId)
        const alertas = { ...(servidor.alertas ?? {}) }
        const checar = async (tipo, pct, limite) => {
            if (pct === null || pct < limite) return
            const ultimo = alertas[tipo] ? new Date(alertas[tipo]).getTime() : 0
            if (Date.now() - ultimo < INTERVALO_ALERTA_RECURSO_MS) return
            alertas[tipo] = new Date()
            await AlertaService.notificar(servidor.tenantId, tipo, { nome: servidor.nome, pct: Math.round(pct) })
        }
        await checar('ram', c.ramTotal ? (c.ramUsada / c.ramTotal) * 100 : null, limites.ram)
        await checar('disco', c.discoTotal ? (c.discoUsado / c.discoTotal) * 100 : null, limites.disco)
        servidor.alertas = alertas
    },

    // Inventário (a cada 6 horas ou quando pedido): sistema, versões, pacotes, projetos e dependências.
    async inventario(servidor, body) {
        const inv = inventarioDTO(body)
        const agora = new Date()
        const eventos = []
        const base = { tenantId: servidor.tenantId, servidorId: servidor._id }

        // Programas com versão nova (nginx 1.24 → 1.26, Node 20.17 → 20.18...).
        const versoesAntigas = Object.fromEntries((servidor.versoes ?? []).map((v) => [v.nome, v.versao]))
        for (const v of inv.versoes) {
            const antiga = proprio(versoesAntigas, v.nome)
            if (antiga && antiga !== v.versao) {
                eventos.push({ ...base, em: agora, tipo: 'sistema', titulo: `${v.nome} ${antiga} → ${v.versao}`, chave: `versao:${v.nome}:${v.versao}` })
            }
        }

        // Histórico do apt: cada execução vira um evento (as automáticas, do unattended-upgrades, ficam marcadas).
        for (const h of inv.aptHistorico) {
            const unico = h.pacotes.length === 1 ? h.pacotes[0] : null
            const titulo = unico
                ? `${unico.nome} ${unico.de ?? ''} → ${unico.para ?? ''}`.replace(/\s+→\s+$/, '')
                : `${h.pacotes.length} pacotes do sistema`
            const detalhe = unico ? null : h.pacotes.slice(0, 30).map((p) => `${p.nome} ${p.de ?? ''} → ${p.para ?? ''}`).join('\n')
            eventos.push({ ...base, em: h.em, tipo: h.automatico ? 'automatico' : 'sistema', titulo, detalhe, chave: `apt:${h.em.toISOString()}` })
        }

        // Projetos: commit novo é deploy; versão instalada diferente é dependência atualizada.
        const projetosAntigos = Object.fromEntries((servidor.projetos ?? []).map((p) => [p.caminho, p]))
        const dependencias = []
        for (const p of inv.projetos) {
            const antigo = proprio(projetosAntigos, p.caminho)
            if (antigo?.commit && p.commit && antigo.commit !== p.commit) {
                eventos.push({ ...base, em: p.commitEm ?? agora, tipo: 'deploy', titulo: `${p.nome}: ${p.mensagem ?? p.commit.slice(0, 7)}`, detalhe: p.commit.slice(0, 12), chave: `deploy:${p.caminho}:${p.commit}` })
            }
            const instaladasAntes = Object.fromEntries((antigo?.instaladas ?? []).map(separarPacote))
            for (const [nome, versao] of Object.entries(p.instaladas)) {
                const antes = proprio(instaladasAntes, nome)
                if (antes && antes !== versao) {
                    eventos.push({ ...base, em: agora, tipo: 'dependencia', titulo: `${nome} ${antes} → ${versao}`, detalhe: p.nome, chave: `dep:${p.caminho}:${nome}:${versao}` })
                }
            }

            const desatualizadas = new Map(p.desatualizadas.map((d) => [d.nome, d]))
            // Pacote com falha conhecida aparece mesmo que não tenha versão nova listada.
            for (const nome of Object.keys(p.vulnerabilidades)) {
                if (!desatualizadas.has(nome) && proprio(p.instaladas, nome)) {
                    desatualizadas.set(nome, { nome, atual: proprio(p.instaladas, nome), nova: null, dev: false })
                }
            }
            for (const d of desatualizadas.values()) {
                const severidade = proprio(p.vulnerabilidades, d.nome) ?? null
                dependencias.push({
                    projeto: p.nome,
                    nome: d.nome,
                    atual: d.atual,
                    nova: d.nova,
                    salto: d.nova ? saltoDeVersao(d.atual, d.nova) : 'outro',
                    categoria: categoriaDoPacote(d.nome),
                    vulneravel: !!severidade,
                    severidade,
                    dev: d.dev,
                })
            }
        }

        // Vulneráveis primeiro (das mais graves), depois os saltos maiores.
        const pesoSalto = { maior: 0, menor: 1, correcao: 2, outro: 3 }
        dependencias.sort((a, b) =>
            (b.vulneravel - a.vulneravel)
            || (ORDEM_SEVERIDADE.indexOf(b.severidade) - ORDEM_SEVERIDADE.indexOf(a.severidade))
            || (pesoSalto[a.salto] - pesoSalto[b.salto])
            || a.nome.localeCompare(b.nome))

        servidor.sistema = { ...servidor.toObject().sistema, ...inv.sistema }
        servidor.versoes = inv.versoes
        servidor.pacotes = { ...inv.pacotes, verificadoEm: agora }
        servidor.projetos = inv.projetos.map((p) => ({ nome: p.nome, caminho: p.caminho, commit: p.commit, commitEm: p.commitEm, mensagem: p.mensagem, erro: p.erro, instaladas: Object.entries(p.instaladas).map(([nome, versao]) => `${nome}@${versao}`) }))
        servidor.dependencias = dependencias.slice(0, 1000)
        servidor.dependenciasVerificadasEm = agora
        servidor.certbot = inv.certbot
        servidor.agente.versao = inv.versao ?? servidor.agente.versao
        servidor.agente.inventarioPendente = false
        servidor.agente.ultimoInventario = agora
        servidor.agente.ultimoContato = agora

        await this.alertarSeguranca(servidor)
        servidor.markModified('alertas')
        servidor.markModified('projetos')
        await servidor.save()
        await registrarEventos(eventos)

        return resposta(servidor)
    },

    // Avisa quando aumenta o número de atualizações de segurança pendentes.
    async alertarSeguranca(servidor) {
        const total = (servidor.pacotes?.lista ?? []).filter((p) => p.seguranca).length
            + (servidor.dependencias ?? []).filter((d) => d.vulneravel).length
        const alertas = { ...(servidor.alertas ?? {}) }
        if (total > (alertas.seguranca ?? 0)) {
            await AlertaService.notificar(servidor.tenantId, 'seguranca', { nome: servidor.nome, total })
        }
        alertas.seguranca = total
        servidor.alertas = alertas
    },
}
