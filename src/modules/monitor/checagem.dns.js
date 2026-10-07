import dns from 'node:dns/promises'

// Descobre onde ficam os e-mails do domínio pelo registro MX.
const PROVEDORES = [
    [/google\.com$|googlemail\.com$/, 'Google Workspace'],
    [/outlook\.com$|office365|microsoft/, 'Microsoft 365'],
    [/hostinger/, 'Hostinger'],
    [/titan\.email$/, 'Titan'],
    [/zoho\./, 'Zoho Mail'],
    [/locaweb/, 'Locaweb'],
    [/kinghost/, 'KingHost'],
    [/umbler/, 'Umbler'],
    [/hostgator/, 'HostGator'],
    [/secureserver\.net$/, 'GoDaddy'],
    [/registro\.br$/, 'Registro.br'],
    [/amazonaws\.com$|awsapps\.com$/, 'Amazon WorkMail / SES'],
]

export async function consultarMx(dominio) {
    try {
        const registros = await dns.resolveMx(dominio)
        const mx = registros.sort((a, b) => a.priority - b.priority).map((r) => r.exchange.toLowerCase())
        const provedor = PROVEDORES.find(([padrao]) => mx.some((host) => padrao.test(host)))?.[1] ?? (mx.length ? 'Outro' : null)
        return { mx, provedorDetectado: provedor }
    } catch {
        return { mx: [], provedorDetectado: null }
    }
}
