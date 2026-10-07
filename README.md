# ManageSystem — backend

API do painel de monitoramento de servidores, domínios e SSL (multi-tenant, pt/en).
Node.js + Fastify 5 + MongoDB (Mongoose), arquitetura MVC por módulo em `src/modules/`.

## Módulos

| Módulo | O que faz |
|---|---|
| `user` | Cadastro (cria a conta + 15 dias grátis), login JWT (access + refresh), minha conta, equipe |
| `plano` | Planos (o grátis vem do seed; os pagos o super_admin cria na tela "Planos") |
| `assinatura` | Cartão pelo **Stripe** (Checkout + Portal + webhook) e **Pix** pelo Mercado Pago (30 dias) |
| `servidor` | Servidores, métricas (1/min, guardadas 31 dias), quedas/lentidões, histórico de atualizações, painel |
| `agente` | Rotas usadas pelo agente (`/api/agente/coleta`, `/inventario`) e o instalador (`/api/agente/install.sh`) |
| `site` | Domínios: vencimento (RDAP, grátis), SSL, provedor de e-mail (MX); renovação e e-mails preenchidos à mão |
| `alerta` | Alertas no Telegram (bot único do sistema) e o que cada conta quer receber |
| `monitor` | Rotinas: URL a cada 1 min, agentes em silêncio, SSL a cada 6 h, domínios a cada 12 h, avisos de vencimento |
| `cliente` | Painel do super_admin: clientes, receita, estender teste, liberar, bloquear |

O agente fica em `agent/` (`agent.mjs` + `install.sh`) e é servido pela própria API.
Mudou a constante `VERSAO` do `agent.mjs` → os agentes instalados se atualizam sozinhos.

## Rodar

```bash
cp .env.example .env   # preencher
npm install
npm run seed           # cria o plano "Teste grátis" (15 dias)
node scripts/criarSuperAdmin.js seu@email.com "SenhaForte123" "Seu nome"
npm start
```

## Configurar os serviços (todos grátis para começar)

- **Stripe**: criar o produto/preço mensal no painel, colar o `price_...` no plano (tela Planos).
  Webhook: `https://SUA-API/api/assinaturas/stripe/webhook` com os eventos `checkout.session.completed`,
  `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`.
  Ativar o **Customer Portal** (Settings → Billing → Customer portal).
- **Mercado Pago (Pix)**: `MP_ACCESS_TOKEN` e webhook `https://SUA-API/api/assinaturas/mercadopago/webhook` (evento Pagamentos).
- **Telegram**: criar o bot no @BotFather, colocar `TELEGRAM_BOT_TOKEN` e um `TELEGRAM_WEBHOOK_SECRET` qualquer.
  Com `APP_URL_BACKEND` em https, o webhook é configurado sozinho ao subir a API.

## Deploy (EC2 própria, separada dos servidores monitorados)

Arquivos em `deploy/`: `managesystem.service` (systemd), `nginx.conf`, `atualizar.sh` e `preparar-servidor.sh`.

1. Criar a EC2 (Ubuntu, t3.micro basta), IP elástico, liberar portas 22/80/443 no Security Group.
2. DNS: registro **A** `api-monitor` → IP elástico.
3. Subir este repositório para o GitHub e, na EC2:
   `bash preparar-servidor.sh <url-do-repo> api-monitor.cestsegtrabalho.com.br <seu-email>`
4. Copiar o `.env` (com `APP_URL_BACKEND=https://api-monitor.cestsegtrabalho.com.br`) e rodar `~/atualizar.sh`.

Atualizações depois: commit + push e `~/atualizar.sh` no servidor.
**Só uma cópia da API com o monitor ligado:** ao rodar no PC com o mesmo banco, use `MONITOR_DESLIGADO=1`.
# managesystem-backend
