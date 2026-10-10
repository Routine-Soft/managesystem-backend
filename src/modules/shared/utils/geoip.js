import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { Reader } from 'maxmind'

// País de uma faixa de IP, pela base gratuita "IP to Country Lite" da DB-IP (licença CC BY 4.0: o painel
// mostra o crédito). A base é baixada sozinha e trocada uma vez por mês; sem ela, o país fica desconhecido.
const PASTA = process.env.GEOIP_PASTA || path.join(os.tmpdir(), 'managesystem-geoip')
const ARQUIVO = path.join(PASTA, 'dbip-country-lite.mmdb')
const VALIDADE_MS = 32 * 24 * 60 * 60 * 1000

let leitor = null
let carregando = null
let tentouEm = 0

function mesesParaTentar() {
    const agora = new Date()
    return [0, 1].map((voltar) => {
        const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - voltar, 1))
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    })
}

async function baixar() {
    fs.mkdirSync(PASTA, { recursive: true })
    for (const mes of mesesParaTentar()) {
        const r = await fetch(`https://download.db-ip.com/free/dbip-country-lite-${mes}.mmdb.gz`, { signal: AbortSignal.timeout(60000) }).catch(() => null)
        if (!r?.ok) continue
        const dados = zlib.gunzipSync(Buffer.from(await r.arrayBuffer()))
        fs.writeFileSync(`${ARQUIVO}.tmp`, dados)
        fs.renameSync(`${ARQUIVO}.tmp`, ARQUIVO)
        return true
    }
    return false
}

async function abrir() {
    let info = null
    try {
        info = fs.statSync(ARQUIVO)
    } catch {
        // ainda não baixada
    }
    if (!info || Date.now() - info.mtimeMs > VALIDADE_MS) {
        const baixou = await baixar().catch(() => false)
        if (!baixou && !info) return null
    }
    return new Reader(fs.readFileSync(ARQUIVO))
}

// Abre a base uma vez (e de novo quando ela vence). Se a internet falhar, tenta de novo em 1 hora.
async function obterLeitor() {
    if (leitor && Date.now() - tentouEm < VALIDADE_MS) return leitor
    if (!leitor && Date.now() - tentouEm < 60 * 60 * 1000 && tentouEm) return null
    carregando ??= abrir()
        .then((r) => {
            if (r) leitor = r
            return leitor
        })
        .catch(() => leitor)
        .finally(() => {
            tentouEm = Date.now()
            carregando = null
        })
    return await carregando
}

// Conta por país (código ISO de 2 letras; "??" quando não dá para saber) a partir de [{ ip, n }].
export async function contarPorPais(faixas) {
    const r = await obterLeitor()
    const paises = {}
    for (const { ip, n } of faixas ?? []) {
        let pais = '??'
        if (r && ip) {
            try {
                pais = r.get(ip)?.country?.iso_code ?? '??'
            } catch {
                pais = '??'
            }
        }
        paises[pais] = (paises[pais] ?? 0) + n
    }
    return paises
}
