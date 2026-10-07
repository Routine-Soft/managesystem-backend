import 'dotenv/config'
import argon2 from 'argon2'
import mongoose from 'mongoose'
import db from '../src/db/db.js'
import UserModel from '../src/modules/user/user.model.js'

// Uso: node scripts/criarSuperAdmin.js email@exemplo.com "Senha forte" "Seu nome"
async function criar() {
    const [email, senha, nome = 'Super Admin'] = process.argv.slice(2)
    if (!email || !senha || senha.length < 8) {
        console.log('Uso: node scripts/criarSuperAdmin.js email senha(8+ caracteres) "Nome"')
        process.exit(1)
    }

    await db()
    const emailNormalizado = email.replace(/\s+/g, '').toLowerCase()
    if (await UserModel.exists({ email: emailNormalizado })) {
        console.log('Já existe um usuário com este e-mail.')
    } else {
        const id = new mongoose.Types.ObjectId()
        await UserModel.create({
            _id: id,
            tenantId: id,
            nomeCompleto: nome,
            email: emailNormalizado,
            password: await argon2.hash(senha),
            nomeEmpresa: 'ManageSystem',
            role: 'super_admin',
        })
        console.log(`Super admin criado: ${emailNormalizado}`)
    }
    await mongoose.disconnect()
}

criar()
