// `params` preenche os trechos {nome} da mensagem depois da tradução (ex.: datas).
class AppError extends Error {

    constructor(message, statusCode, codigo, params) {

        super(message)

        this.statusCode = statusCode
        this.codigo = codigo
        this.params = params

    }

}

export default AppError
