// CPF e CNPJ: o Mercado Pago exige o documento de quem paga o Pix. A validação evita mandar lixo para a API.

export function somenteDigitos(valor) {
    return String(valor ?? '').replace(/\D/g, '')
}

function digitoVerificador(digitos, pesos) {
    const soma = digitos.reduce((total, digito, i) => total + digito * pesos[i], 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
}

function cpfValido(cpf) {
    const d = cpf.split('').map(Number)
    return digitoVerificador(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) === d[9]
        && digitoVerificador(d.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === d[10]
}

function cnpjValido(cnpj) {
    const d = cnpj.split('').map(Number)
    return digitoVerificador(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === d[12]
        && digitoVerificador(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === d[13]
}

// Devolve { tipo: 'CPF' | 'CNPJ', numero } ou null se o documento for inválido.
export function interpretarDocumento(valor) {
    const digitos = somenteDigitos(valor)
    if (/^(\d)\1+$/.test(digitos)) return null

    if (digitos.length === 11 && cpfValido(digitos)) return { tipo: 'CPF', numero: digitos }
    if (digitos.length === 14 && cnpjValido(digitos)) return { tipo: 'CNPJ', numero: digitos }
    return null
}
