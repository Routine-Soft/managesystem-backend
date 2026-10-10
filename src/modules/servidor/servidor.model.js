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

    // Quanto o servidor custa por mês no provedor (AWS, Hostinger...). Preenchido à mão.
    custo: {
        valor: { type: Number, default: null },
        moeda: { type: String, default: 'USD' },
        provedor: { type: String, default: null },
    },

    // Sistema que roda num container de outro servidor cadastrado (ex.: rara no VPS da OVH):
    // o cartão mostra a RAM e a CPU desse container, lidas pelo agente da máquina.
    container: {
        servidorId: { type: ObjectId, ref: 'servidores', default: null },
        nome: { type: String, default: null },
    },

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
        // Instalado com --permitir-acoes: o painel pode pedir "instalar atualizações" e "reiniciar".
        acoesPermitidas: { type: Boolean, default: false },
    },

    // Ações pedidas pelo painel (as 10 mais recentes). pendente → enviada (ao agente) → executando → ok/erro;
    // sem resposta do agente em 30 min vira expirada.
    acoes: [{
        tipo: { type: String, enum: ['atualizar', 'reiniciar'] },
        status: { type: String, enum: ['pendente', 'enviada', 'executando', 'ok', 'erro', 'expirada'], default: 'pendente' },
        pedidaEm: Date,
        pedidaPor: String,
        iniciadaEm: Date,
        concluidaEm: Date,
        saida: String,
    }],

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
        // Atualizações automáticas de segurança (unattended-upgrades): true, false ou null (não é Debian/Ubuntu).
        atualizacoesAutomaticas: { type: Boolean, default: null },
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
        // Quem renova o HTTPS: certbot (Nginx) ou o próprio Caddy.
        ferramenta: { type: String, default: 'certbot' },
    },

    // Últimas linhas de erro (Nginx, serviços do systemd e containers).
    logs: [{ _id: false, em: Date, origem: String, linha: String }],

    // Containers Docker da máquina (última leitura do agente). Vazio quando não há Docker.
    containers: [{
        _id: false,
        nome: String,
        projeto: String,
        imagem: String,
        estado: String,
        status: String,
        saude: String,
        cpu: Number,
        ramUsada: Number,
        ramLimite: Number,
        reinicios: Number,
        oom: Boolean,
        iniciadoEm: Date,
    }],
    containersEm: Date,

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
