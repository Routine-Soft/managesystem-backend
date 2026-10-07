// Etiquetas das dependências: categoria do pacote e tamanho do salto de versão.

const CATEGORIAS = {
    seguranca: [
        'jsonwebtoken', 'jose', 'jwt-decode', 'argon2', 'bcrypt', 'bcryptjs', 'helmet', 'passport', 'passport-jwt',
        'passport-local', 'passport-google-oauth20', '@fastify/jwt', '@fastify/helmet', '@fastify/rate-limit',
        'express-rate-limit', 'csurf', 'crypto-js', 'google-auth-library', 'next-auth', '@auth/core', 'oauth',
        'openid-client', 'express-session', '@fastify/cookie', 'cookie-parser', 'cors', '@fastify/cors',
        'node-forge', 'otplib', 'speakeasy', 'sanitize-html', 'dompurify', 'xss', 'validator', 'firebase-admin',
    ],
    servidor: ['express', 'fastify', 'koa', '@nestjs/core', '@hapi/hapi', 'next', 'nuxt', 'restify', 'socket.io', 'ws', 'nodemon', 'pm2'],
    banco: ['mongoose', 'mongodb', 'pg', 'mysql', 'mysql2', 'prisma', '@prisma/client', 'sequelize', 'typeorm', 'redis', 'ioredis', 'knex', 'sqlite3', 'better-sqlite3', 'drizzle-orm'],
    pagamento: ['stripe', 'mercadopago', '@paypal/checkout-server-sdk', 'pagarme', 'asaas'],
    frontend: ['react', 'react-dom', 'react-router-dom', 'vue', 'vite', '@angular/core', 'svelte', 'tailwindcss', 'next'],
    http: ['axios', 'node-fetch', 'got', 'undici', 'superagent', 'request'],
}

const MAPA = new Map()
for (const [categoria, nomes] of Object.entries(CATEGORIAS)) {
    for (const nome of nomes) if (!MAPA.has(nome)) MAPA.set(nome, categoria)
}

export function categoriaDoPacote(nome) {
    return MAPA.get(nome) ?? 'outros'
}

function partes(versao) {
    const m = String(versao ?? '').match(/(\d+)\.(\d+)\.(\d+)/)
    return m ? m.slice(1).map(Number) : null
}

// Em versões 0.x, subir o "menor" já pode quebrar compatibilidade (regra do semver).
export function saltoDeVersao(atual, nova) {
    const a = partes(atual)
    const b = partes(nova)
    if (!a || !b) return 'outro'
    if (b[0] !== a[0]) return 'maior'
    if (b[1] !== a[1]) return a[0] === 0 ? 'maior' : 'menor'
    if (b[2] !== a[2]) return 'correcao'
    return 'outro'
}
