import mongoose from 'mongoose'

const { Mixed, ObjectId } = mongoose.Schema.Types

const pacoteSchema = new mongoose.Schema({
    nome: String,
    atual: String,
    nova: String,
    seguranca: Boolean,
}, { _id: false })

const dependenciaSchema = new mongoose.Schema({
    projeto: String,
    nome: String,
    atual: String,
    nova: String,
    // Tamanho do salto de versão (semver): maior quebra compatibilidade, correcao é só conserto.
    salto: { type: String, enum: ['maior', 'menor', 'correcao', 'outro'] },
    // Categoria do pacote (seguranca, servidor, banco...) e falha conhecida apontada pelo npm audit.
    categoria: String,
    vulneravel: Boolean,
    severidade: String,
    dev: Boolean,
}, { _id: false })

const servidorSchema = new mongoose.Schema({
    tenantId: { type: ObjectId, ref: 'users', required: true, index: true },
    nome: { type: String, required: true, trim: true },
    // Endereço verificado de fora a cada minuto (no ar / queda / lentidão / SSL). Opcional.
    url: { type: String, default: null },
    limiteLentidaoMs: { type: Number, default: 3000 },

    // Só o hash do token do agente fica no banco; o token aparece uma única vez, no comando de instalação.
    tokenHash: { type: String, default: null, index: true },

    // aguardando: agente ainda não falou com a API. online / lento / offline: estado atual.
    status: { type: String, enum: ['aguardando', 'online', 'lento', 'offline'], default: 'aguardando' },
    statusDesde: { type: Date, default: Date.now },

    agente: {
        ultimoContato: { type: Date, default: null },
        versao: { type: String, default: null },
        ip: { type: String, default: null },
        // Pedido de "verificar agora": o agente manda o inventário completo no próximo minuto.
        inventarioPendente: { type: Boolean, default: true },
        ultimoInventario: { type: Date, default: null },
    },

    sistema: {
        hostname: String,
        so: String,
        kernel: String,
        arquitetura: String,
        cpuModelo: String,
        cpus: Number,
        ramTotal: Number,
        discoTotal: Number,
        bootEm: Date,
    },

    // Última leitura do agente (para os cartões, sem ir no histórico).
    atual: {
        em: Date,
        cpu: Number,
        load1: Number,
        ramTotal: Number,
        ramUsada: Number,
        discoTotal: Number,
        discoUsado: Number,
    },

    versoes: [{ _id: false, nome: String, versao: String }],

    pacotes: {
        lista: [pacoteSchema],
        reinicioNecessario: { type: Boolean, default: false },
        verificadoEm: Date,
    },

    projetos: [{
        _id: false,
        nome: String,
        caminho: String,
        commit: String,
        commitEm: Date,
        mensagem: String,
        erro: String,
        // Versões instaladas ("nome@versao"), para perceber quando uma dependência foi atualizada.
        instaladas: [String],
    }],
    dependencias: [dependenciaSchema],
    dependenciasVerificadasEm: Date,

    certbot: {
        instalado: Boolean,
        renovacaoAutomatica: Boolean,
        certificados: [String],
    },

    // Últimas linhas de erro (Nginx e serviços do systemd).
    logs: [{ _id: false, em: Date, origem: String, linha: String }],

    ssl: {
        valido: Boolean,
        emissor: String,
        expiraEm: Date,
        verificadoEm: Date,
        erro: String,
    },

    ultimaVerificacao: {
        em: Date,
        ok: Boolean,
        ms: Number,
        statusHttp: Number,
        erro: String,
    },
    falhasSeguidas: { type: Number, default: 0 },
    lentasSeguidas: { type: Number, default: 0 },

    // Quando cada alerta foi mandado (evita repetir o mesmo aviso no Telegram).
    alertas: { type: Mixed, default: {} },

}, { timestamps: true, minimize: false })

servidorSchema.methods.toJSON = function () {
    const obj = this.toObject()
    delete obj.tokenHash
    delete obj.alertas
    for (const projeto of obj.projetos ?? []) delete projeto.instaladas
    return obj
}

const ServidorModel = mongoose.models.servidores || mongoose.model('servidores', servidorSchema)

export default ServidorModel
