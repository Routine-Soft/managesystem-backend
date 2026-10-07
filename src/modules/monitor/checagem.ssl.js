import tls from 'node:tls'

// Abre uma conexão TLS e lê o certificado que o site entrega (validade e emissor).
// Funciona para qualquer site, sem precisar do agente.
export function verificarSsl(host, porta = 443) {
    return new Promise((resolve) => {
        const fim = (dados) => {
            socket.destroy()
            resolve({ ...dados, verificadoEm: new Date() })
        }

        const socket = tls.connect({ host, port: porta, servername: host, rejectUnauthorized: false, timeout: 10000 }, () => {
            const cert = socket.getPeerCertificate()
            if (!cert || !cert.valid_to) {
                fim({ valido: false, erro: 'O site não apresentou certificado' })
                return
            }
            const expiraEm = new Date(cert.valid_to)
            const emissor = cert.issuer?.O || cert.issuer?.CN || null
            const erroDeConfianca = socket.authorized ? null : String(socket.authorizationError || '')
            fim({
                valido: socket.authorized && expiraEm > new Date(),
                emissor,
                expiraEm,
                erro: erroDeConfianca || (expiraEm <= new Date() ? 'Certificado vencido' : null),
            })
        })

        socket.on('timeout', () => fim({ valido: false, erro: 'Sem resposta na porta 443' }))
        socket.on('error', (error) => fim({ valido: false, erro: error.code || error.message }))
    })
}
