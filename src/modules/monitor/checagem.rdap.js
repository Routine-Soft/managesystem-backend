// Datas do domínio (registro e vencimento) pelo RDAP, o substituto público e gratuito do WHOIS.
// O endereço do RDAP de cada final (.com, .br, .net...) vem da lista oficial da IANA.

const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json'
const RESERVA = {
    br: 'https://rdap.registro.br/',
    com: 'https://rdap.verisign.com/com/v1/',
    net: 'https://rdap.verisign.com/net/v1/',
}

let cache = { em: 0, mapa: null }

async function mapaDeServidores() {
    if (cache.mapa && Date.now() - cache.em < 24 * 60 * 60 * 1000) return cache.mapa
    try {
        const resposta = await fetch(BOOTSTRAP_URL, { signal: AbortSignal.timeout(15000) })
        const dados = await resposta.json()
        const mapa = {}
        for (const [finais, urls] of dados.services ?? []) {
            for (const final of finais) mapa[final.toLowerCase()] = urls[0]
        }
        cache = { em: Date.now(), mapa }
        return mapa
    } catch {
        return cache.mapa ?? RESERVA
    }
}

function servidorPara(mapa, dominio) {
    const partes = dominio.split('.')
    // Do final mais longo para o mais curto (ex.: "com.br" antes de "br").
    for (let i = 1; i < partes.length; i++) {
        const final = partes.slice(i).join('.')
        if (mapa[final]) return mapa[final]
    }
    return RESERVA[partes.at(-1)] ?? null
}

function dataDoEvento(eventos, acao) {
    const evento = (eventos ?? []).find((e) => e.eventAction === acao)
    return evento?.eventDate ? new Date(evento.eventDate) : null
}

function nomeDoRegistrador(entidades) {
    const registrador = (entidades ?? []).find((e) => e.roles?.includes('registrar'))
    const vcard = registrador?.vcardArray?.[1] ?? []
    return vcard.find((campo) => campo[0] === 'fn')?.[3] ?? null
}

async function consultar(base, dominio) {
    const url = `${base.replace(/\/?$/, '/')}domain/${encodeURIComponent(dominio)}`
    const resposta = await fetch(url, {
        headers: { Accept: 'application/rdap+json, application/json' },
        signal: AbortSignal.timeout(15000),
    })
    if (resposta.status === 404) return null
    if (!resposta.ok) throw new Error(`RDAP respondeu ${resposta.status}`)
    return await resposta.json()
}

// Tenta o domínio informado e, se for subdomínio (app.exemplo.com), sobe até achar o domínio registrado.
export async function consultarDominio(dominio) {
    const mapa = await mapaDeServidores()
    const partes = dominio.toLowerCase().split('.')

    for (let i = 0; i <= partes.length - 2; i++) {
        const candidato = partes.slice(i).join('.')
        const base = servidorPara(mapa, candidato)
        if (!base) {
            return { verificadoEm: new Date(), erro: 'Não há consulta pública (RDAP) para este final de domínio. Preencha as datas à mão.' }
        }
        try {
            const dados = await consultar(base, candidato)
            if (!dados) continue
            return {
                dominioRegistrado: candidato,
                criadoEm: dataDoEvento(dados.events, 'registration'),
                expiraEm: dataDoEvento(dados.events, 'expiration'),
                atualizadoEm: dataDoEvento(dados.events, 'last changed'),
                registrador: nomeDoRegistrador(dados.entities),
                status: dados.status ?? [],
                verificadoEm: new Date(),
                erro: null,
            }
        } catch (error) {
            return { verificadoEm: new Date(), erro: error.message }
        }
    }
    return { verificadoEm: new Date(), erro: 'Domínio não encontrado na consulta pública' }
}
