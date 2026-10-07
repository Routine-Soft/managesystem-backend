import { escapar } from './telegram.js'

// Textos dos alertas do Telegram nos dois idiomas. Cada função recebe dados já prontos e devolve HTML do Telegram.

function duracao(minutos, idioma) {
    const m = Math.max(1, Math.round(minutos))
    if (m < 60) return idioma === 'en' ? `${m} min` : `${m} min`
    const h = Math.floor(m / 60)
    const resto = m % 60
    return resto ? `${h}h ${resto}min` : `${h}h`
}

function dias(n, idioma) {
    if (n <= 0) return idioma === 'en' ? 'today' : 'hoje'
    if (n === 1) return idioma === 'en' ? 'in 1 day' : 'em 1 dia'
    return idioma === 'en' ? `in ${n} days` : `em ${n} dias`
}

const n = (nome) => `<b>${escapar(nome)}</b>`

const TEXTOS = {
    pt: {
        queda: ({ nome, motivo }) => `🔴 ${n(nome)} está <b>fora do ar</b>.${motivo ? `\nMotivo: <code>${escapar(motivo)}</code>` : ''}`,
        voltou: ({ nome, minutos }) => `🟢 ${n(nome)} <b>voltou</b> ao ar. Ficou fora por ${duracao(minutos, 'pt')}.`,
        lentidao: ({ nome, ms }) => `🟡 ${n(nome)} está <b>lento</b>: respondendo em ${(ms / 1000).toFixed(1)} s.`,
        lentidaoFim: ({ nome }) => `🟢 ${n(nome)} voltou a responder no tempo normal.`,
        agente: ({ nome }) => `⚪ O agente de ${n(nome)} parou de enviar dados há alguns minutos. O site pode estar no ar, mas RAM, CPU e disco não estão sendo atualizados.`,
        agenteVoltou: ({ nome }) => `🟢 O agente de ${n(nome)} voltou a enviar dados.`,
        ram: ({ nome, pct }) => `🟠 ${n(nome)} está usando <b>${pct}% da memória RAM</b>.`,
        disco: ({ nome, pct }) => `🟠 O disco de ${n(nome)} está <b>${pct}% cheio</b>.`,
        ssl: ({ nome, restantes }) => restantes <= 0
            ? `🔴 O certificado SSL de ${n(nome)} <b>venceu</b>. Os visitantes veem um aviso de "site não seguro".`
            : `🔐 O certificado SSL de ${n(nome)} vence <b>${dias(restantes, 'pt')}</b>.`,
        dominio: ({ nome, restantes }) => restantes <= 0
            ? `🔴 O domínio ${n(nome)} <b>venceu</b>. Renove o quanto antes para não perder o site e os e-mails.`
            : `🌐 O domínio ${n(nome)} vence <b>${dias(restantes, 'pt')}</b>. Lembre de renovar.`,
        emails: ({ nome, restantes }) => `✉️ O plano de e-mails de ${n(nome)} vence <b>${dias(restantes, 'pt')}</b>.`,
        seguranca: ({ nome, total }) => `🛡️ ${n(nome)} tem <b>${total} atualização(ões) de segurança</b> pendente(s) (sistema ou dependências).`,
        teste: () => '✅ Tudo certo! Os alertas do ManageSystem vão chegar aqui.',
        conectado: ({ empresa }) => `✅ Telegram conectado à conta ${n(empresa)}. Os alertas vão chegar aqui.`,
        codigoInvalido: () => 'Este link de conexão não vale mais. Gere um novo no painel, em "Alertas".',
        boasVindas: () => 'Olá! Para receber alertas, abra o painel do ManageSystem, vá em "Alertas" e clique em "Conectar Telegram".',
    },
    en: {
        queda: ({ nome, motivo }) => `🔴 ${n(nome)} is <b>down</b>.${motivo ? `\nReason: <code>${escapar(motivo)}</code>` : ''}`,
        voltou: ({ nome, minutos }) => `🟢 ${n(nome)} is <b>back up</b>. It was down for ${duracao(minutos, 'en')}.`,
        lentidao: ({ nome, ms }) => `🟡 ${n(nome)} is <b>slow</b>: responding in ${(ms / 1000).toFixed(1)} s.`,
        lentidaoFim: ({ nome }) => `🟢 ${n(nome)} is responding normally again.`,
        agente: ({ nome }) => `⚪ The agent on ${n(nome)} stopped sending data a few minutes ago. The site may be up, but RAM, CPU and disk are not being updated.`,
        agenteVoltou: ({ nome }) => `🟢 The agent on ${n(nome)} is sending data again.`,
        ram: ({ nome, pct }) => `🟠 ${n(nome)} is using <b>${pct}% of its RAM</b>.`,
        disco: ({ nome, pct }) => `🟠 The disk on ${n(nome)} is <b>${pct}% full</b>.`,
        ssl: ({ nome, restantes }) => restantes <= 0
            ? `🔴 The SSL certificate for ${n(nome)} has <b>expired</b>. Visitors see a "not secure" warning.`
            : `🔐 The SSL certificate for ${n(nome)} expires <b>${dias(restantes, 'en')}</b>.`,
        dominio: ({ nome, restantes }) => restantes <= 0
            ? `🔴 The domain ${n(nome)} has <b>expired</b>. Renew it soon so you don't lose the site and e-mails.`
            : `🌐 The domain ${n(nome)} expires <b>${dias(restantes, 'en')}</b>. Remember to renew it.`,
        emails: ({ nome, restantes }) => `✉️ The e-mail plan for ${n(nome)} expires <b>${dias(restantes, 'en')}</b>.`,
        seguranca: ({ nome, total }) => `🛡️ ${n(nome)} has <b>${total} pending security update(s)</b> (system or dependencies).`,
        teste: () => '✅ All set! ManageSystem alerts will arrive here.',
        conectado: ({ empresa }) => `✅ Telegram connected to ${n(empresa)}. Alerts will arrive here.`,
        codigoInvalido: () => 'This connection link is no longer valid. Create a new one in the dashboard, under "Alerts".',
        boasVindas: () => 'Hi! To get alerts, open the ManageSystem dashboard, go to "Alerts" and click "Connect Telegram".',
    },
}

export function textoDoAlerta(idioma, tipo, dados = {}) {
    const lista = TEXTOS[idioma] ?? TEXTOS.pt
    return lista[tipo](dados)
}
