import mongoose from 'mongoose'

// Cluster "saas", banco "managesystem".
const db = async () => {
    await mongoose.connect(`mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@saas.du44abf.mongodb.net/managesystem?retryWrites=true&w=majority`, {
    }).then(() => {
        console.log('Conectado ao MongoDB')
    }).catch((error) => {
        console.log('Erro ao conectar ao MongoDB ' + error)
    })
}

export default db
