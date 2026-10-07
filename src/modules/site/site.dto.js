import AppError from '../../errors/AppError.js'

const DOMINIO_VALIDO = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/

// Aceita "https://www.exemplo.com.br/qualquer" e guarda "exemplo.com.br".
export function normalizarDominio(valor) {
    let texto = String(valor ?? '').trim().toLowerCase()
    texto = texto.replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0].replace(/^www\./, '').replace(/\.$/, '')
    if (!DOMINIO_VALIDO.test(texto)) {
        throw new AppError('Domínio inválido. Exemplo: meusite.com.br', 400)
    }
    return texto
}

function data(valor) {
    if (!valor) return null
    const d = new Date(valor)
    return Number.isNaN(d.getTime()) ? null : d
}

function numero(valor) {
    if (valor === null || valor === undefined || valor === '') return null
    const n = Number(String(valor).replace(',', '.'))
    return Number.isFinite(n) && n >= 0 ? n : null
}

function texto(valor) {
    return String(valor ?? '').trim() || null
}

function moeda(valor) {
    return ['BRL', 'USD', 'EUR'].includes(valor) ? valor : 'BRL'
}

const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function siteDTO(body) {
    const dto = {}
    if ('dominio' in body) dto.dominio = normalizarDominio(body.dominio)
    if ('servidorId' in body) dto.servidorId = body.servidorId || null

    if (body.manual && typeof body.manual === 'object') {
        const m = body.manual
        dto.manual = {
            criadoEm: data(m.criadoEm),
            expiraEm: data(m.expiraEm),
            registrador: texto(m.registrador),
            valorRenovacao: numero(m.valorRenovacao),
            moeda: moeda(m.moeda),
            renovacaoAutomatica: !!m.renovacaoAutomatica,
            observacao: texto(m.observacao),
        }
    }

    if (body.emails && typeof body.emails === 'object') {
        const e = body.emails
        const caixas = Array.isArray(e.caixas) ? e.caixas : []
        dto.emails = {
            provedor: texto(e.provedor),
            vencimento: data(e.vencimento),
            valor: numero(e.valor),
            moeda: moeda(e.moeda),
            periodicidade: e.periodicidade === 'mensal' ? 'mensal' : 'anual',
            caixas: caixas
                .map((c) => ({
                    endereco: String(c?.endereco ?? '').replace(/\s+/g, '').toLowerCase(),
                    cotaGB: numero(c?.cotaGB),
                    usadoGB: numero(c?.usadoGB),
                }))
                .filter((c) => c.endereco),
        }
        const invalida = dto.emails.caixas.find((c) => !EMAIL_VALIDO.test(c.endereco))
        if (invalida) {
            throw new AppError('E-mail inválido: {email}', 400, null, { email: invalida.endereco })
        }
    }
    return dto
}
