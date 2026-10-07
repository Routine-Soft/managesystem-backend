import 'dotenv/config'
import mongoose from 'mongoose'
import db from '../src/db/db.js'
import PlanoModel from '../src/modules/plano/plano.model.js'

// Cria o plano de teste grátis (15 dias). Os planos pagos são criados na tela "Planos" do super_admin.
async function seed() {
    await db()

    const existente = await PlanoModel.findOne({ tipo: 'gratis' })
    if (existente) {
        console.log(`Plano grátis já existe (id ${existente._id}), nada a fazer.`)
    } else {
        const criado = await PlanoModel.create({
            nome: 'Teste grátis',
            descricao: '15 dias para experimentar tudo, sem cartão.',
            tipo: 'gratis',
            duracaoDiasTrial: 15,
            limiteServidores: 3,
            limiteSites: 5,
            ativo: true,
        })
        console.log(`Plano grátis criado (id ${criado._id}).`)
    }

    await mongoose.disconnect()
}

seed()
