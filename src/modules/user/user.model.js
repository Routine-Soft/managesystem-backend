import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
    nomeCompleto: { type: String, required: true, trim: true },
    // Sempre sem espaços e em minúsculas, para o login não depender de como a pessoa digitou.
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        set: (valor) => (typeof valor === 'string' ? valor.replace(/\s+/g, '') : valor),
    },
    password: { type: String, required: true },
    telefone: { type: String, default: null },
    nomeEmpresa: { type: String, required: true, trim: true },

    // admin: dono da conta (paga a assinatura, gerencia a equipe). membro: vê e gerencia os servidores e sites.
    role: {
        type: String,
        enum: ['super_admin', 'admin', 'membro'],
        default: 'admin',
    },

    // Idioma das telas, das mensagens da API e dos alertas do Telegram.
    idioma: { type: String, enum: ['pt', 'en'], default: 'pt' },

    // tenantId aponta pra si mesmo quando o usuário é o dono da conta (admin).
    // Usuários criados depois dentro da mesma conta herdam esse mesmo tenantId.
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },

    tokenRefresh: { type: String, default: null },

}, { timestamps: true })

userSchema.methods.toJSON = function () {
    const obj = this.toObject()
    delete obj.password
    delete obj.tokenRefresh
    return obj
}

const UserModel = mongoose.models.users || mongoose.model('users', userSchema)

export default UserModel
