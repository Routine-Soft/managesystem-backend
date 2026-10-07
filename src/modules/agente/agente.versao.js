import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Arquivos do agente servidos pela API (o script de instalação baixa daqui).
const PASTA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../agent')

export const ARQUIVO_DO_AGENTE = path.join(PASTA, 'agent.mjs')
export const ARQUIVO_DE_INSTALACAO = path.join(PASTA, 'install.sh')

// A versão vem da constante VERSAO dentro do próprio agent.mjs: mudou o arquivo, os agentes se atualizam.
export const VERSAO_DO_AGENTE = (() => {
    try {
        return fs.readFileSync(ARQUIVO_DO_AGENTE, 'utf8').match(/const VERSAO = '([^']+)'/)?.[1] ?? '0.0.0'
    } catch {
        return '0.0.0'
    }
})()
