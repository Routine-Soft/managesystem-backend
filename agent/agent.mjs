// Agente do ManageSystem.
// Roda no servidor do cliente (serviço systemd "managesystem-agent"), só LÊ informações da máquina e as ENVIA
// para a API por HTTPS. Não abre porta e não executa comandos vindos de fora.
// Usa só módulos nativos do Node (sem dependências), com o Node próprio instalado em /opt/managesystem-agent.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const VERSAO = '1.1.0'

const PASTA_DADOS = process.env.MSA_DADOS || '/var/lib/managesystem-agent'
const ARQUIVO_CONFIG = process.env.MSA_CONFIG || '/etc/managesystem-agent/config.json'
const ARQUIVO_ESTADO = path.join(PASTA_DADOS, 'estado.json')

const MINUTO = 60 * 1000
const INTERVALO_INVENTARIO = 6 * 60 * MINUTO
const LIMITE_LEITURA_LOG = 50 * 1024 * 1024

const config = JSON.parse(fs.readFileSync(ARQUIVO_CONFIG, 'utf8'))
const API = String(config.api).replace(/\/+$/, '')

function log(...partes) {
    console.log(new Date().toISOString(), ...partes)
}

// ---------------------------------------------------------------- estado salvo entre reinícios

function lerEstado() {
    try {
        return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'))
    } catch {
        return {}
    }
}

const estado = lerEstado()

function salvarEstado() {
    try {
        fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado))
    } catch (error) {
        log('Não foi possível salvar o estado:', error.message)
    }
}

// ---------------------------------------------------------------- utilidades

// Executa um programa SEM shell (nada de texto vindo de fora vira comando). Nunca rejeita: devolve '' se falhar.
function executar(programa, args = [], { tempo = 20000 } = {}) {
    return new Promise((resolve) => {
        execFile(programa, args, { timeout: tempo, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (erro, stdout, stderr) => {
            resolve({ ok: !erro, saida: String(stdout ?? ''), erro: String(stderr ?? '') })
        })
    })
}

function lerArquivo(caminho) {
    try {
        return fs.readFileSync(caminho, 'utf8')
    } catch {
        return null
    }
}

function lerJson(caminho) {
    const texto = lerArquivo(caminho)
    if (!texto) return null
    try {
        return JSON.parse(texto)
    } catch {
        return null
    }
}

async function enviar(rota, corpo) {
    const resposta = await fetch(`${API}/api/agente/${rota}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}`, 'User-Agent': `managesystem-agent/${VERSAO}` },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(30000),
    })
    const dados = await resposta.json().catch(() => ({}))
    if (!resposta.ok) {
        const erro = new Error(dados.message || `HTTP ${resposta.status}`)
        erro.status = resposta.status
        throw erro
    }
    return dados.data ?? {}
}

// ---------------------------------------------------------------- CPU, RAM, disco

function lerCpu() {
    const linha = (lerArquivo('/proc/stat') ?? '').split('\n')[0]
    const valores = linha.trim().split(/\s+/).slice(1).map(Number)
    const ocioso = (valores[3] ?? 0) + (valores[4] ?? 0)
    const total = valores.reduce((a, b) => a + b, 0)
    return { ocioso, total }
}

let cpuAnterior = lerCpu()

function usoDeCpu() {
    const atual = lerCpu()
    const total = atual.total - cpuAnterior.total
    const ocioso = atual.ocioso - cpuAnterior.ocioso
    cpuAnterior = atual
    return total > 0 ? Math.round(((total - ocioso) / total) * 1000) / 10 : null
}

function memoria() {
    const texto = lerArquivo('/proc/meminfo') ?? ''
    const valor = (chave) => Number(texto.match(new RegExp(`^${chave}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) * 1024
    const total = valor('MemTotal') || os.totalmem()
    const disponivel = valor('MemAvailable') || os.freemem()
    return { total, disponivel }
}

function disco() {
    try {
        const s = fs.statfsSync('/')
        const total = s.blocks * s.bsize
        return { total, usado: total - s.bfree * s.bsize }
    } catch {
        return { total: null, usado: null }
    }
}

// ---------------------------------------------------------------- logs (Nginx e journal)

// Lê só o que foi escrito no arquivo desde a última leitura (percebe quando o logrotate troca o arquivo).
function novasLinhas(chave, caminho) {
    let info
    try {
        info = fs.statSync(caminho)
    } catch {
        return []
    }
    const anterior = estado[chave] ?? {}
    let inicio = anterior.inode === info.ino && anterior.posicao <= info.size ? anterior.posicao : null
    // Primeira leitura: começa do fim (o passado não interessa como "novo").
    if (inicio === null) inicio = anterior.inode === undefined ? info.size : 0
    if (info.size - inicio > LIMITE_LEITURA_LOG) inicio = info.size - LIMITE_LEITURA_LOG

    estado[chave] = { inode: info.ino, posicao: info.size }
    if (info.size <= inicio) return []

    const fd = fs.openSync(caminho, 'r')
    try {
        const buffer = Buffer.alloc(info.size - inicio)
        fs.readSync(fd, buffer, 0, buffer.length, inicio)
        return buffer.toString('utf8').split('\n').filter(Boolean)
    } finally {
        fs.closeSync(fd)
    }
}

// Logs de acesso lidos a cada minuto: Nginx (texto) e Caddy (JSON). Os que não existem são ignorados.
const LOGS_DE_ACESSO = Array.isArray(config.accessLogs) && config.accessLogs.length
    ? config.accessLogs
    : [config.nginxAccessLog || '/var/log/nginx/access.log', '/var/log/caddy/access.log']

// Status HTTP de uma linha: Caddy grava JSON ({"status":200,...}); Nginx grava texto ("GET / HTTP/1.1" 200 ...).
function lerLinhaDeAcesso(linha) {
    if (linha.startsWith('{')) {
        try {
            const j = JSON.parse(linha)
            const r = j.request ?? {}
            return { status: Number(j.status), em: j.ts ? new Date(j.ts * 1000) : new Date(), resumo: `${r.method ?? ''} ${r.host ?? ''}${r.uri ?? ''}`.trim() }
        } catch {
            return null
        }
    }
    const status = Number(linha.match(/" (\d{3}) /)?.[1])
    return status ? { status } : null
}

// Conta as requisições novas. Erros 5xx do Caddy também viram linhas de log (o Caddy não tem error.log separado).
function requisicoes() {
    const contagem = { total: 0, s4xx: 0, s5xx: 0 }
    const erros = []
    for (const caminho of LOGS_DE_ACESSO) {
        for (const linha of novasLinhas(`acesso:${caminho}`, caminho)) {
            const r = lerLinhaDeAcesso(linha)
            if (!r?.status) continue
            contagem.total++
            if (r.status >= 500) {
                contagem.s5xx++
                if (r.resumo) erros.push({ em: r.em.toISOString(), origem: 'caddy', linha: `HTTP ${r.status} · ${r.resumo}`.slice(0, 500) })
            } else if (r.status >= 400) {
                contagem.s4xx++
            }
        }
    }
    return { contagem, erros }
}

function errosDoNginx() {
    const caminho = config.nginxErrorLog || '/var/log/nginx/error.log'
    return novasLinhas('errorLog', caminho)
        .filter((linha) => /\[(error|crit|alert|emerg)\]/.test(linha))
        .map((linha) => {
            const data = linha.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}:\d{2}:\d{2})/)
            return { em: data ? new Date(`${data[1]}-${data[2]}-${data[3]}T${data[4]}`).toISOString() : new Date().toISOString(), origem: 'nginx', linha: linha.slice(0, 500) }
        })
}

async function errosDoJournal() {
    const args = ['-p', '0..3', '-o', 'json', '--no-pager', '-q']
    if (estado.journalCursor) args.push(`--after-cursor=${estado.journalCursor}`)
    else args.push('--since', '-2min')
    const { ok, saida } = await executar('journalctl', args)
    if (!ok && !saida) return []

    const linhas = []
    for (const texto of saida.split('\n').filter(Boolean)) {
        try {
            const e = JSON.parse(texto)
            estado.journalCursor = e.__CURSOR
            const mensagem = Array.isArray(e.MESSAGE) ? Buffer.from(e.MESSAGE).toString('utf8') : String(e.MESSAGE ?? '')
            linhas.push({
                em: new Date(Number(e.__REALTIME_TIMESTAMP) / 1000).toISOString(),
                origem: e._SYSTEMD_UNIT || e.SYSLOG_IDENTIFIER || 'sistema',
                linha: mensagem.slice(0, 500),
            })
        } catch {
            // linha que não é JSON: ignora
        }
    }
    return linhas
}

// ---------------------------------------------------------------- coleta de cada minuto

async function coleta() {
    const ram = memoria()
    const acesso = requisicoes()
    const logs = [...errosDoNginx(), ...acesso.erros, ...(await errosDoJournal())]
    const corpo = {
        versao: VERSAO,
        cpu: usoDeCpu(),
        load: os.loadavg(),
        ram,
        disco: disco(),
        uptime: os.uptime(),
        req: acesso.contagem,
        errosTotal: logs.length,
        logs: logs.slice(-50),
    }
    salvarEstado()
    return await enviar('coleta', corpo)
}

// ---------------------------------------------------------------- inventário (a cada 6 horas)

function versaoNoTexto(texto) {
    return texto.match(/v?(\d+\.\d+(?:\.\d+)?(?:[-+~][\w.]+)?)/)?.[1] ?? null
}

async function versoesDosProgramas() {
    const programas = [
        ['Node.js', 'node', ['-v']],
        ['npm', 'npm', ['-v']],
        ['Nginx', 'nginx', ['-v']],
        ['Apache', 'apache2', ['-v']],
        ['PM2', 'pm2', ['-v']],
        ['Docker', 'docker', ['--version']],
        ['MongoDB', 'mongod', ['--version']],
        ['PostgreSQL', 'psql', ['--version']],
        ['MySQL', 'mysql', ['--version']],
        ['Redis', 'redis-server', ['--version']],
        ['PHP', 'php', ['-v']],
        ['Python', 'python3', ['--version']],
        ['Git', 'git', ['--version']],
        ['Certbot', 'certbot', ['--version']],
        ['OpenSSL', 'openssl', ['version']],
    ]
    const versoes = []
    for (const [nome, programa, args] of programas) {
        const { saida, erro } = await executar(programa, args, { tempo: 8000 })
        // Alguns programas (nginx, certbot antigo) escrevem a versão no stderr.
        const texto = `${saida}\n${erro}`.split('\n').find((l) => /\d+\.\d+/.test(l)) ?? ''
        const versao = versaoNoTexto(texto.replace(/^.*?(version|v)\s*/i, ''))
        if (versao) versoes.push({ nome, versao })
    }
    return versoes
}

function sistemaOperacional() {
    const texto = lerArquivo('/etc/os-release') ?? ''
    const nome = texto.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1]
    return nome ?? `${os.type()} ${os.release()}`
}

// Pacotes do sistema com atualização: apt (Ubuntu/Debian) ou dnf (Fedora/RHEL/Amazon Linux).
async function pacotesPendentes() {
    const reinicioNecessario = fs.existsSync('/var/run/reboot-required')

    const apt = await executar('apt', ['list', '--upgradable'], { tempo: 60000 })
    if (apt.ok) {
        // O mesmo pacote pode aparecer uma vez por arquitetura (amd64 e i386): fica uma linha só.
        const pacotes = new Map()
        for (const linha of apt.saida.split('\n')) {
            const m = linha.match(/^([^/\s]+)\/(\S+)\s+(\S+)\s+\S+\s+\[upgradable from: ([^\]]+)\]/)
            if (m && !pacotes.has(m[1])) pacotes.set(m[1], { nome: m[1], nova: m[3], atual: m[4], seguranca: /-security/.test(m[2]) })
        }
        return { lista: [...pacotes.values()], reinicioNecessario }
    }

    const dnf = await executar('dnf', ['-q', 'check-update'], { tempo: 120000 })
    if (dnf.saida) {
        const seguranca = new Set()
        const sec = await executar('dnf', ['-q', 'updateinfo', 'list', '--security'], { tempo: 120000 })
        for (const linha of sec.saida.split('\n')) {
            const pacote = linha.trim().split(/\s+/)[2]
            if (pacote) seguranca.add(pacote.replace(/-\d.*$/, ''))
        }
        const lista = dnf.saida.split('\n')
            .map((l) => l.trim().split(/\s+/))
            .filter((p) => p.length >= 3 && p[0].includes('.'))
            .map(([pacote, nova]) => {
                const nome = pacote.replace(/\.[^.]+$/, '')
                return { nome, atual: null, nova, seguranca: seguranca.has(nome) }
            })
        return { lista, reinicioNecessario }
    }

    return { lista: [], reinicioNecessario }
}

// /var/log/apt/history.log (e o .1.gz anterior): cada execução do apt com os pacotes atualizados/instalados.
function historicoDoApt() {
    const textos = []
    try {
        textos.push(zlib.gunzipSync(fs.readFileSync('/var/log/apt/history.log.1.gz')).toString('utf8'))
    } catch {
        // não existe ainda
    }
    textos.push(lerArquivo('/var/log/apt/history.log') ?? '')

    const entradas = []
    for (const bloco of textos.join('\n\n').split(/\n\s*\n/)) {
        const inicio = bloco.match(/^Start-Date:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/m)
        if (!inicio) continue
        const pacotes = []
        for (const acao of ['Upgrade', 'Install']) {
            const linha = bloco.match(new RegExp(`^${acao}:\\s*(.+)$`, 'm'))?.[1]
            if (!linha) continue
            // Formato: nome:arch (antiga, nova), outro:arch (versao, automatic)
            for (const m of linha.matchAll(/([^\s,]+?)(?::\w+)? \(([^)]*)\)/g)) {
                const versoes = m[2].split(',').map((v) => v.trim())
                if (acao === 'Upgrade') pacotes.push({ nome: m[1], de: versoes[0], para: versoes[1] })
                else if (!versoes.includes('automatic')) pacotes.push({ nome: m[1], de: null, para: versoes[0] })
            }
        }
        if (!pacotes.length) continue
        entradas.push({
            em: new Date(`${inicio[1]}T${inicio[2]}`).toISOString(),
            // Execuções do unattended-upgrades não registram "Commandline".
            automatico: !/^Commandline:/m.test(bloco),
            pacotes,
        })
    }
    return entradas.slice(-40)
}

async function certbot() {
    const instalado = fs.existsSync('/etc/letsencrypt') || (await executar('certbot', ['--version'], { tempo: 8000 })).ok
    let renovacaoAutomatica = false
    for (const timer of ['certbot.timer', 'snap.certbot.renew.timer']) {
        const { saida } = await executar('systemctl', ['is-active', timer], { tempo: 8000 })
        if (saida.trim() === 'active') renovacaoAutomatica = true
    }
    // Instalação antiga do certbot usa cron em vez de timer.
    if (!renovacaoAutomatica && fs.existsSync('/etc/cron.d/certbot')) renovacaoAutomatica = true

    let certificados = []
    try {
        certificados = fs.readdirSync('/etc/letsencrypt/renewal').filter((a) => a.endsWith('.conf')).map((a) => a.replace(/\.conf$/, ''))
    } catch {
        // sem certificados
    }
    return { instalado, renovacaoAutomatica, certificados }
}

// ---------------------------------------------------------------- projetos Node (package.json)

const PASTAS_IGNORADAS = new Set(['node_modules', '.git', '.cache', '.npm', '.nvm', '.local', '.config', 'snap', 'dist', 'build', '.next', 'tmp'])

function encontrarProjetos() {
    if (Array.isArray(config.projetos) && config.projetos.length) {
        return config.projetos.filter((p) => fs.existsSync(path.join(p, 'package.json')))
    }

    const raizes = ['/var/www', '/srv', '/opt', '/root']
    try {
        for (const usuario of fs.readdirSync('/home')) raizes.push(path.join('/home', usuario))
    } catch {
        // sem /home
    }

    const achados = []
    const visitar = (pasta, profundidade) => {
        if (achados.length >= 20 || pasta.startsWith('/opt/managesystem-agent')) return
        if (fs.existsSync(path.join(pasta, 'package.json'))) {
            achados.push(pasta)
            return
        }
        if (profundidade === 0) return
        let itens = []
        try {
            itens = fs.readdirSync(pasta, { withFileTypes: true })
        } catch {
            return
        }
        for (const item of itens) {
            if (item.isDirectory() && !item.isSymbolicLink() && !PASTAS_IGNORADAS.has(item.name) && !item.name.startsWith('.')) {
                visitar(path.join(pasta, item.name), profundidade - 1)
            }
        }
    }
    for (const raiz of raizes) visitar(raiz, 3)
    return achados
}

function comparar(a, b) {
    const pa = String(a).split(/[.-]/).map((n) => parseInt(n, 10) || 0)
    const pb = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0)
    for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
    return 0
}

// Confere se a versão está dentro da faixa afetada do aviso (ex.: "<3.0.3", ">=2.0.0 <2.0.5 || <1.4.1").
function versaoNaFaixa(versao, faixa) {
    const texto = String(faixa ?? '').trim()
    if (!texto || texto === '*') return true
    return texto.split('||').some((parte) => {
        const comparacoes = [...parte.matchAll(/(<=|>=|<|>|=)?\s*v?(\d+(?:\.\d+){0,2})/g)]
        if (!comparacoes.length) return false
        return comparacoes.every(([, operador = '=', alvo]) => {
            const c = comparar(versao, alvo)
            return { '<': c < 0, '<=': c <= 0, '>': c > 0, '>=': c >= 0, '=': c === 0 }[operador]
        })
    })
}

const cacheDeVersoes = new Map()

async function ultimaVersao(nome) {
    if (cacheDeVersoes.has(nome)) return cacheDeVersoes.get(nome)
    let versao = null
    try {
        const resposta = await fetch(`https://registry.npmjs.org/-/package/${nome.replace('/', '%2F')}/dist-tags`, { signal: AbortSignal.timeout(15000) })
        if (resposta.ok) versao = (await resposta.json()).latest ?? null
    } catch {
        // registro fora do ar: tenta na próxima vez
    }
    cacheDeVersoes.set(nome, versao)
    return versao
}

// Falhas conhecidas: a mesma consulta que o "npm audit" faz ao registro do npm.
async function vulnerabilidades(pacotes) {
    const corpo = {}
    for (const [nome, versao] of pacotes) (corpo[nome] ??= []).includes(versao) || corpo[nome].push(versao)
    if (!Object.keys(corpo).length) return {}
    try {
        const resposta = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo),
            signal: AbortSignal.timeout(30000),
        })
        if (!resposta.ok) return {}
        const dados = await resposta.json()
        const ordem = ['info', 'low', 'moderate', 'high', 'critical']
        const resultado = {}
        for (const [nome, avisos] of Object.entries(dados)) {
            for (const aviso of avisos ?? []) {
                // A consulta devolve os avisos do pacote inteiro; só conta o que pega alguma versão instalada.
                if (!(corpo[nome] ?? []).some((v) => versaoNaFaixa(v, aviso.vulnerable_versions))) continue
                // Guarda a mais grave de todas as falhas do pacote.
                if (!resultado[nome] || ordem.indexOf(aviso.severity) > ordem.indexOf(resultado[nome])) resultado[nome] = aviso.severity
            }
        }
        return resultado
    } catch {
        return {}
    }
}

async function emParalelo(itens, limite, tarefa) {
    const fila = [...itens]
    await Promise.all(Array.from({ length: Math.min(limite, fila.length) }, async () => {
        while (fila.length) await tarefa(fila.shift())
    }))
}

async function analisarProjeto(pasta) {
    const pacote = lerJson(path.join(pasta, 'package.json')) ?? {}
    const projeto = { nome: pacote.name || path.basename(pasta), caminho: pasta, instaladas: {}, desatualizadas: [], vulnerabilidades: {} }

    const git = await executar('git', ['-c', 'safe.directory=*', '-C', pasta, 'log', '-1', '--format=%H%x1f%cI%x1f%s'], { tempo: 10000 })
    if (git.ok && git.saida.trim()) {
        const [commit, data, mensagem] = git.saida.trim().split('\x1f')
        Object.assign(projeto, { commit, commitEm: data, mensagem })
    }

    const diretas = { ...(pacote.dependencies ?? {}) }
    const deDesenvolvimento = new Set(Object.keys(pacote.devDependencies ?? {}))
    Object.assign(diretas, pacote.devDependencies ?? {})

    // Versões instaladas: node_modules, ou o package-lock.json quando não há node_modules.
    const lock = lerJson(path.join(pasta, 'package-lock.json'))
    const todas = []
    for (const nome of Object.keys(diretas)) {
        const versao = lerJson(path.join(pasta, 'node_modules', nome, 'package.json'))?.version
            ?? lock?.packages?.[`node_modules/${nome}`]?.version
        if (versao) projeto.instaladas[nome] = versao
    }
    for (const [chave, info] of Object.entries(lock?.packages ?? {})) {
        if (!chave || !info?.version) continue
        const nome = chave.slice(chave.lastIndexOf('node_modules/') + 'node_modules/'.length)
        todas.push([nome, info.version])
    }
    if (!todas.length) todas.push(...Object.entries(projeto.instaladas))

    if (!Object.keys(diretas).length) return projeto
    if (!Object.keys(projeto.instaladas).length) {
        projeto.erro = 'Dependências não instaladas (sem node_modules e sem package-lock.json)'
        return projeto
    }

    await emParalelo(Object.entries(projeto.instaladas), 8, async ([nome, atual]) => {
        const ultima = await ultimaVersao(nome)
        if (ultima && comparar(ultima, atual) > 0) {
            projeto.desatualizadas.push({ nome, atual, nova: ultima, dev: deDesenvolvimento.has(nome) })
        }
    })
    projeto.vulnerabilidades = await vulnerabilidades(todas)

    // Pacote vulnerável que não é dependência direta: entra com a versão do lock para aparecer na lista.
    for (const nome of Object.keys(projeto.vulnerabilidades)) {
        if (!projeto.instaladas[nome]) {
            const versao = todas.find(([n]) => n === nome)?.[1]
            if (versao) projeto.instaladas[nome] = versao
        }
    }
    return projeto
}

async function inventario() {
    const cpus = os.cpus()
    const d = disco()
    const projetos = []
    for (const pasta of encontrarProjetos()) {
        projetos.push(await analisarProjeto(pasta).catch((error) => ({ nome: path.basename(pasta), caminho: pasta, erro: error.message })))
    }
    const corpo = {
        versao: VERSAO,
        sistema: {
            hostname: os.hostname(),
            so: sistemaOperacional(),
            kernel: os.release(),
            arquitetura: os.arch(),
            cpuModelo: cpus[0]?.model?.trim() ?? null,
            cpus: cpus.length,
            ramTotal: memoria().total,
            discoTotal: d.total,
        },
        versoes: await versoesDosProgramas(),
        pacotes: await pacotesPendentes(),
        aptHistorico: historicoDoApt(),
        projetos,
        certbot: await certbot(),
    }
    const resposta = await enviar('inventario', corpo)
    estado.ultimoInventario = Date.now()
    salvarEstado()
    return resposta
}

// ---------------------------------------------------------------- atualização automática do agente

async function atualizarAgente(versaoNova) {
    log(`Atualizando o agente: ${VERSAO} → ${versaoNova}`)
    const resposta = await fetch(`${API}/api/agente/agent.mjs`, { signal: AbortSignal.timeout(30000) })
    const codigo = await resposta.text()
    if (!resposta.ok || !codigo.includes("const VERSAO = '")) throw new Error('Download do agente inválido')
    const destino = fileURLToPath(import.meta.url)
    fs.writeFileSync(`${destino}.novo`, codigo)
    fs.renameSync(`${destino}.novo`, destino)
    // O systemd reinicia o serviço já com o código novo.
    process.exit(0)
}

// ---------------------------------------------------------------- laço principal

let pausaAte = 0

async function ciclo() {
    if (Date.now() < pausaAte) return
    try {
        const resposta = await coleta()
        const inventarioVencido = !estado.ultimoInventario || Date.now() - estado.ultimoInventario > INTERVALO_INVENTARIO
        if (resposta.inventarioPendente || inventarioVencido) {
            await inventario()
        }
        if (resposta.versaoAgente && resposta.versaoAgente !== VERSAO) {
            await atualizarAgente(resposta.versaoAgente).catch((error) => log('Falha ao atualizar o agente:', error.message))
        }
    } catch (error) {
        if (error.status === 401) {
            log('Token recusado pela API. Gere um novo comando no painel e instale de novo.')
            pausaAte = Date.now() + 10 * MINUTO
        } else if (error.status === 402) {
            log('A assinatura da conta não está ativa. Tentando de novo em 30 minutos.')
            pausaAte = Date.now() + 30 * MINUTO
        } else {
            log('Erro ao enviar dados:', error.message)
        }
    }
}

log(`Agente do ManageSystem ${VERSAO} iniciado. API: ${API}`)
// Primeira leitura de CPU precisa de um intervalo para comparar.
setTimeout(() => {
    ciclo()
    setInterval(ciclo, MINUTO)
}, 3000)
