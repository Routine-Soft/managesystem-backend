import { telegramConfigurado, definirWebhook, removerWebhook, buscarAtualizacoes } from './telegram.js'
import { AlertaService } from './alerta.service.js'
import { urlPublicaDaApi } from '../servidor/servidor.token.js'

// Recebe as mensagens do bot. Em produção (API com https) usa webhook; em desenvolvimento, consulta o Telegram.
export async function iniciarBotTelegram() {
    if (!telegramConfigurado() || process.env.MONITOR_DESLIGADO === '1') return

    const base = urlPublicaDaApi()
    if (base.startsWith('https://') && process.env.TELEGRAM_WEBHOOK_SECRET) {
        try {
            await definirWebhook(`${base}/api/telegram/webhook`, process.env.TELEGRAM_WEBHOOK_SECRET)
            console.log('Telegram: webhook configurado')
        } catch (error) {
            console.error('Telegram: não foi possível configurar o webhook:', error.message)
        }
        return
    }

    await removerWebhook().catch(() => null)
    console.log('Telegram: consultando mensagens (modo desenvolvimento)')
    let offset = 0
    const consultar = async () => {
        try {
            const atualizacoes = await buscarAtualizacoes(offset)
            for (const u of atualizacoes) {
                offset = u.update_id + 1
                await AlertaService.processarMensagemDoBot(u.message).catch((error) => console.error('Telegram:', error.message))
            }
        } catch (error) {
            console.error('Telegram:', error.message)
            await new Promise((resolve) => setTimeout(resolve, 10000))
        }
        setImmediate(consultar)
    }
    consultar()
}
