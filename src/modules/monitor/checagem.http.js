// Chama a URL e mede o tempo de resposta. Qualquer resposta abaixo de 500 conta como "no ar"
// (um 401 ou 404 ainda é o servidor respondendo); erro de rede, tempo esgotado ou 5xx é queda.
const TEMPO_MAXIMO_MS = 20000

export async function verificarUrl(url) {
    const inicio = performance.now()
    try {
        const resposta = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            headers: { 'User-Agent': 'ManageSystem-Monitor/1.0 (+uptime)' },
            signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
        })
        // Não baixa o corpo inteiro: só o tempo até a resposta interessa.
        resposta.body?.cancel().catch(() => null)
        const ms = Math.round(performance.now() - inicio)
        return { ok: resposta.status < 500, ms, statusHttp: resposta.status, erro: resposta.status >= 500 ? `HTTP ${resposta.status}` : null }
    } catch (error) {
        const ms = Math.round(performance.now() - inicio)
        return { ok: false, ms, statusHttp: null, erro: motivoDaFalha(error) }
    }
}

// Código técnico do erro (ECONNREFUSED, ENOTFOUND, CERT_HAS_EXPIRED...), que vale em qualquer idioma.
function motivoDaFalha(error) {
    if (error?.name === 'TimeoutError') return 'TIMEOUT (20 s)'
    const causa = error?.cause
    return causa?.code || causa?.errors?.[0]?.code || causa?.message || error?.message || 'ERRO_DE_CONEXAO'
}
