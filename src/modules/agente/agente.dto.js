// O agente roda no servidor do cliente, então tudo o que ele manda é tratado como entrada não confiável:
// números são conferidos, textos cortados e listas limitadas.

export function numero(valor, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const n = Number(valor)
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : null
}

export function texto(valor, max = 200) {
    if (valor === null || valor === undefined) return null
    const t = String(valor).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim()
    return t ? t.slice(0, max) : null
}

export function data(valor) {
    if (!valor) return null
    const d = new Date(valor)
    return Number.isNaN(d.getTime()) ? null : d
}

export function lista(valor, max) {
    return Array.isArray(valor) ? valor.slice(0, max) : []
}

export function coletaDTO(body) {
    const b = body ?? {}
    const ramTotal = numero(b.ram?.total)
    const ramDisponivel = numero(b.ram?.disponivel)
    const discoTotal = numero(b.disco?.total)
    const discoUsado = numero(b.disco?.usado)
    return {
        versao: texto(b.versao, 20),
        cpu: numero(b.cpu, { max: 100 }),
        load1: numero(b.load?.[0], { max: 10000 }),
        ramTotal,
        ramUsada: ramTotal !== null && ramDisponivel !== null ? Math.max(ramTotal - ramDisponivel, 0) : null,
        discoTotal,
        discoUsado,
        uptime: numero(b.uptime),
        req: numero(b.req?.total) ?? 0,
        req4xx: numero(b.req?.s4xx) ?? 0,
        req5xx: numero(b.req?.s5xx) ?? 0,
        erros: numero(b.errosTotal) ?? 0,
        logs: lista(b.logs, 50)
            .map((l) => ({ em: data(l?.em) ?? new Date(), origem: texto(l?.origem, 60), linha: texto(l?.linha, 500) }))
            .filter((l) => l.linha),
    }
}

export function inventarioDTO(body) {
    const b = body ?? {}
    const s = b.sistema ?? {}
    return {
        versao: texto(b.versao, 20),
        sistema: {
            hostname: texto(s.hostname, 100),
            so: texto(s.so, 100),
            kernel: texto(s.kernel, 100),
            arquitetura: texto(s.arquitetura, 30),
            cpuModelo: texto(s.cpuModelo, 120),
            cpus: numero(s.cpus, { max: 4096 }),
            ramTotal: numero(s.ramTotal),
            discoTotal: numero(s.discoTotal),
        },
        versoes: lista(b.versoes, 40)
            .map((v) => ({ nome: texto(v?.nome, 40), versao: texto(v?.versao, 60) }))
            .filter((v) => v.nome && v.versao),
        pacotes: {
            lista: lista(b.pacotes?.lista, 2000)
                .map((p) => ({ nome: texto(p?.nome, 120), atual: texto(p?.atual, 80), nova: texto(p?.nova, 80), seguranca: !!p?.seguranca }))
                .filter((p) => p.nome),
            reinicioNecessario: !!b.pacotes?.reinicioNecessario,
        },
        aptHistorico: lista(b.aptHistorico, 100)
            .map((h) => ({
                em: data(h?.em),
                automatico: !!h?.automatico,
                pacotes: lista(h?.pacotes, 500)
                    .map((p) => ({ nome: texto(p?.nome, 120), de: texto(p?.de, 80), para: texto(p?.para, 80) }))
                    .filter((p) => p.nome),
            }))
            .filter((h) => h.em && h.pacotes.length),
        projetos: lista(b.projetos, 30).map((p) => ({
            nome: texto(p?.nome, 120),
            caminho: texto(p?.caminho, 300),
            commit: texto(p?.commit, 64),
            commitEm: data(p?.commitEm),
            mensagem: texto(p?.mensagem, 200),
            erro: texto(p?.erro, 300),
            instaladas: Object.fromEntries(
                Object.entries(p?.instaladas ?? {}).slice(0, 800)
                    .map(([nome, versao]) => [texto(nome, 120), texto(versao, 60)])
                    .filter(([nome, versao]) => nome && versao)
            ),
            desatualizadas: lista(p?.desatualizadas, 500)
                .map((d) => ({ nome: texto(d?.nome, 120), atual: texto(d?.atual, 60), nova: texto(d?.nova, 60), dev: !!d?.dev }))
                .filter((d) => d.nome),
            vulnerabilidades: Object.fromEntries(
                Object.entries(p?.vulnerabilidades ?? {}).slice(0, 500)
                    .map(([nome, sev]) => [texto(nome, 120), texto(sev, 20)])
                    .filter(([nome]) => nome)
            ),
        })).filter((p) => p.caminho),
        certbot: {
            instalado: !!b.certbot?.instalado,
            renovacaoAutomatica: !!b.certbot?.renovacaoAutomatica,
            certificados: lista(b.certbot?.certificados, 50).map((c) => texto(c, 120)).filter(Boolean),
        },
    }
}
