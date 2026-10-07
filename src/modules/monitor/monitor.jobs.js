import ServidorModel from '../servidor/servidor.model.js'
import VerificacaoModel from '../servidor/verificacao.model.js'
import EventoModel from '../servidor/evento.model.js'
import SiteModel from '../site/site.model.js'
import { SiteService } from '../site/site.service.js'
import { AssinaturaService } from '../assinatura/assinatura.service.js'
import { AlertaService } from '../alerta/alerta.service.js'
import { EstadoService } from './estado.service.js'
import { verificarUrl } from './checagem.http.js'
import { verificarSsl } from './checagem.ssl.js'

// Rotinas automáticas do monitor. Rodam dentro da própria API (uma instância só).

const MINUTO = 60 * 1000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

// Queda só é confirmada depois de 2 falhas seguidas; lentidão depois de 3 respostas lentas seguidas.
const FALHAS_PARA_QUEDA = 2
const LENTAS_PARA_ALERTA = 3
const SILENCIO_DO_AGENTE_MS = 3 * MINUTO
const ESTAGIOS_DE_AVISO = [60, 30, 14, 7, 3, 1, 0]

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Roda `tarefa` para cada item com no máximo `limite` ao mesmo tempo.
async function emParalelo(itens, limite, tarefa) {
    const fila = [...itens]
    const trabalhadores = Array.from({ length: Math.min(limite, fila.length) }, async () => {
        while (fila.length) {
            const item = fila.shift()
            await tarefa(item).catch((error) => console.error('Monitor:', error.message))
        }
    })
    await Promise.all(trabalhadores)
}

// Contas com acesso liberado nesta rodada (quem está com a assinatura parada não é monitorado).
function filtroDeAcesso() {
    const cache = new Map()
    return async (tenantId) => {
        const chave = String(tenantId)
        if (!cache.has(chave)) cache.set(chave, (await AssinaturaService.verificarAcesso(tenantId)).liberado)
        return cache.get(chave)
    }
}

function diasAte(data) {
    return Math.ceil((new Date(data).getTime() - Date.now()) / DIA)
}

// Estágio atual do aviso de vencimento (ex.: com 10 dias faltando e limite de 14, o estágio é 14).
// Devolve null se ainda está longe do limite configurado.
function estagioDoAviso(dias, limiteDias) {
    const estagios = ESTAGIOS_DE_AVISO.filter((e) => e <= limiteDias)
    if (dias > limiteDias) return null
    return [...estagios].reverse().find((e) => dias <= e) ?? 0
}

// ---------- Verificação de fora, a cada minuto ----------

async function verificarServidor(servidor) {
    const r = await verificarUrl(servidor.url)
    const lento = r.ok && r.ms > (servidor.limiteLentidaoMs || 3000)
    const agora = new Date()

    await VerificacaoModel.create({ servidorId: servidor._id, em: agora, ok: r.ok, lento, ms: r.ms, statusHttp: r.statusHttp })
    servidor.ultimaVerificacao = { em: agora, ok: r.ok, ms: r.ms, statusHttp: r.statusHttp, erro: r.erro }

    if (!r.ok) {
        servidor.falhasSeguidas = (servidor.falhasSeguidas ?? 0) + 1
        servidor.lentasSeguidas = 0
        if (servidor.falhasSeguidas >= FALHAS_PARA_QUEDA) {
            await EstadoService.marcarQueda(servidor, r.erro)
        }
    } else {
        servidor.falhasSeguidas = 0
        servidor.lentasSeguidas = lento ? (servidor.lentasSeguidas ?? 0) + 1 : 0
        if (servidor.lentasSeguidas >= LENTAS_PARA_ALERTA) {
            await EstadoService.marcarNoAr(servidor, { lento: true })
            await EstadoService.marcarLentidao(servidor, r.ms)
        } else {
            // Lento uma ou duas vezes ainda não muda o status (evita alarme por um pico isolado).
            await EstadoService.marcarNoAr(servidor, { lento: servidor.status === 'lento' && lento })
            if (!lento) await EstadoService.fecharLentidao(servidor)
        }
    }
    await servidor.save()
}

export async function cicloDeUrls() {
    const liberado = filtroDeAcesso()
    const servidores = await ServidorModel.find({ url: { $ne: null } })
    const ativos = []
    for (const s of servidores) if (await liberado(s.tenantId)) ativos.push(s)
    await emParalelo(ativos, 10, verificarServidor)
}

// ---------- Agentes em silêncio ----------

export async function cicloDeAgentes() {
    const limite = new Date(Date.now() - SILENCIO_DO_AGENTE_MS)
    const silenciosos = await ServidorModel.find({ status: { $ne: 'aguardando' }, 'agente.ultimoContato': { $lt: limite } })
    for (const servidor of silenciosos) {
        if (!servidor.url) {
            // Sem URL, o silêncio do agente é a única pista: conta como queda.
            if (servidor.status !== 'offline') {
                await EstadoService.marcarQueda(servidor, 'O agente parou de enviar dados')
                await servidor.save()
            }
        } else if (!servidor.alertas?.agenteSemContato) {
            servidor.alertas = { ...servidor.alertas, agenteSemContato: new Date() }
            servidor.markModified('alertas')
            await servidor.save()
            await AlertaService.notificar(servidor.tenantId, 'agente', { nome: servidor.nome })
        }
    }
}

// ---------- Certificado SSL dos servidores ----------

async function verificarSslDoServidor(servidor) {
    const host = new URL(servidor.url).hostname
    const anterior = servidor.ssl?.expiraEm ? new Date(servidor.ssl.expiraEm) : null
    const ssl = await verificarSsl(host)
    servidor.ssl = ssl

    // Validade que avançou é renovação (no Let's Encrypt, feita sozinha pelo certbot).
    if (anterior && ssl.expiraEm && ssl.expiraEm.getTime() - anterior.getTime() > DIA) {
        await EventoModel.create({
            tenantId: servidor.tenantId,
            servidorId: servidor._id,
            em: new Date(),
            tipo: 'automatico',
            titulo: 'Certificado SSL renovado',
            detalhe: `${host} · ${ssl.emissor ?? ''}`.trim(),
            chave: `ssl:${host}:${ssl.expiraEm.toISOString()}`,
        }).catch(() => null)
    }
    await servidor.save()
}

export async function cicloDeSsl() {
    const liberado = filtroDeAcesso()
    const servidores = await ServidorModel.find({ url: /^https:/i })
    const ativos = []
    for (const s of servidores) if (await liberado(s.tenantId)) ativos.push(s)
    await emParalelo(ativos, 5, verificarSslDoServidor)
}

// ---------- Domínios (RDAP), SSL e MX dos sites ----------

export async function cicloDeSites() {
    const liberado = filtroDeAcesso()
    const sites = await SiteModel.find({})
    for (const site of sites) {
        if (!(await liberado(site.tenantId))) continue
        await SiteService.verificar(site).catch((error) => console.error('Monitor (site):', error.message))
        // Devagar, para não ser bloqueado pelos servidores públicos de RDAP.
        await espera(1500)
    }
}

// ---------- Avisos de vencimento (SSL, domínio, e-mails) ----------

async function avisarVencimento(doc, chave, tipo, nome, expiraEm, limiteDias) {
    if (!expiraEm) return false
    const dias = diasAte(expiraEm)
    const estagio = estagioDoAviso(dias, limiteDias)
    if (estagio === null) return false

    const marca = `${new Date(expiraEm).toISOString()}|${estagio}`
    if (doc.alertas?.[chave] === marca) return false

    await AlertaService.notificar(doc.tenantId, tipo, { nome, restantes: dias })
    doc.alertas = { ...doc.alertas, [chave]: marca }
    doc.markModified('alertas')
    return true
}

export async function cicloDeAvisos() {
    const liberado = filtroDeAcesso()
    const hostsComServidor = new Map()

    for (const servidor of await ServidorModel.find({ 'ssl.expiraEm': { $ne: null } })) {
        if (!(await liberado(servidor.tenantId))) continue
        const host = new URL(servidor.url).hostname
        hostsComServidor.set(`${servidor.tenantId}:${host.replace(/^www\./, '')}`, true)
        const limites = await AlertaService.limitesDoTenant(servidor.tenantId)
        if (await avisarVencimento(servidor, 'ssl', 'ssl', host, servidor.ssl.expiraEm, limites.diasSsl)) await servidor.save()
    }

    for (const site of await SiteModel.find({})) {
        if (!(await liberado(site.tenantId))) continue
        const limites = await AlertaService.limitesDoTenant(site.tenantId)
        let mudou = false
        // O SSL do mesmo endereço já é avisado pelo servidor; aqui só os sites sem servidor monitorando.
        if (!hostsComServidor.has(`${site.tenantId}:${site.dominio}`)) {
            mudou = (await avisarVencimento(site, 'ssl', 'ssl', site.dominio, site.ssl?.expiraEm, limites.diasSsl)) || mudou
        }
        const expiraDominio = site.manual?.expiraEm ?? site.registro?.expiraEm
        mudou = (await avisarVencimento(site, 'dominio', 'dominio', site.dominio, expiraDominio, limites.diasDominio)) || mudou
        mudou = (await avisarVencimento(site, 'emails', 'emails', site.dominio, site.emails?.vencimento, 15)) || mudou
        if (mudou) await site.save()
    }
}

// ---------- Agenda ----------

function repetir(nome, intervaloMs, primeiraEmMs, tarefa) {
    let rodando = false
    const executar = async () => {
        if (rodando) return
        rodando = true
        try {
            await tarefa()
        } catch (error) {
            console.error(`Monitor (${nome}):`, error.message)
        } finally {
            rodando = false
        }
    }
    setTimeout(() => {
        executar()
        setInterval(executar, intervaloMs).unref()
    }, primeiraEmMs).unref()
}

export function iniciarMonitor() {
    if (process.env.MONITOR_DESLIGADO === '1') {
        console.log('Monitor desligado (MONITOR_DESLIGADO=1)')
        return
    }
    repetir('urls', MINUTO, 5 * 1000, cicloDeUrls)
    repetir('agentes', MINUTO, 20 * 1000, cicloDeAgentes)
    repetir('ssl', 6 * HORA, 30 * 1000, cicloDeSsl)
    repetir('sites', 12 * HORA, 60 * 1000, cicloDeSites)
    repetir('avisos', HORA, 2 * MINUTO, cicloDeAvisos)
    console.log('Monitor iniciado')
}

export const _paraTestes = { estagioDoAviso, diasAte }
