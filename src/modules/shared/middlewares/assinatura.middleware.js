import AppError from '../../../errors/AppError.js'
import { AssinaturaService } from '../../assinatura/assinatura.service.js'

// Barra as rotas do cliente quando a assinatura não dá mais acesso (teste vencido, cancelada, em atraso).
// Vem DEPOIS de `authenticate`. 402 = "pagamento necessário"; o código faz o frontend mostrar a tela de assinatura.
export async function exigirAssinaturaAtiva(req) {
    if (req.user?.role === 'super_admin') return

    const { liberado, motivo } = await AssinaturaService.verificarAcesso(req.user.tenantId)
    if (!liberado) {
        throw new AppError(motivo, 402, 'ASSINATURA_INATIVA')
    }
}
