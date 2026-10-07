// Regra de bloqueio do sistema. Só olha datas e status, sem gravar nada.
//  - trial / pendente: acesso até o fim do teste
//  - ativa: liberado (se foi paga por Pix, só até o fim do período pago)
//  - cancelada: acesso até o fim do período que já foi pago (proximaCobranca)
//  - inadimplente: tolerância de alguns dias a partir do atraso
//  - expirada: bloqueado

export const DIAS_DE_TOLERANCIA_INADIMPLENTE = 5
export const DIA_EM_MS = 24 * 60 * 60 * 1000

export function avaliarAcesso(assinatura, agora = new Date()) {
    if (!assinatura) {
        return { liberado: false, motivo: 'Esta conta não possui assinatura. Entre em contato com o suporte.', ate: null }
    }

    if (assinatura.acessoRevogado) {
        return { liberado: false, motivo: 'O acesso desta conta foi bloqueado pelo suporte. Entre em contato para regularizar.', ate: null }
    }

    const noFuturo = (data) => !!data && new Date(data) > agora

    switch (assinatura.status) {
        case 'ativa':
            // Pix e liberação manual não renovam sozinhos: valem até proximaCobranca.
            if (['pix', 'manual'].includes(assinatura.cobranca)) {
                return noFuturo(assinatura.proximaCobranca)
                    ? { liberado: true, motivo: null, ate: assinatura.proximaCobranca }
                    : { liberado: false, motivo: 'O período pago terminou. Renove o pagamento para continuar usando o sistema.', ate: null }
            }
            return { liberado: true, motivo: null, ate: null }

        case 'trial':
        case 'pendente':
            return noFuturo(assinatura.dataFimTrial)
                ? { liberado: true, motivo: null, ate: assinatura.dataFimTrial }
                : { liberado: false, motivo: 'O período de teste terminou. Assine um plano para continuar usando o sistema.', ate: null }

        case 'cancelada':
            return noFuturo(assinatura.proximaCobranca)
                ? { liberado: true, motivo: null, ate: assinatura.proximaCobranca }
                : { liberado: false, motivo: 'A assinatura foi cancelada. Assine novamente para voltar a usar o sistema.', ate: null }

        case 'inadimplente': {
            const desde = assinatura.inadimplenteDesde ?? assinatura.updatedAt ?? agora
            const limite = new Date(new Date(desde).getTime() + DIAS_DE_TOLERANCIA_INADIMPLENTE * DIA_EM_MS)
            return limite > agora
                ? { liberado: true, motivo: null, ate: limite }
                : { liberado: false, motivo: 'Não conseguimos cobrar a assinatura. Atualize o cartão para voltar a usar o sistema.', ate: null }
        }

        default:
            return { liberado: false, motivo: 'A assinatura está inativa. Assine um plano para continuar usando o sistema.', ate: null }
    }
}
