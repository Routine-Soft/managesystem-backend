# ServerFall (antigo ManageSystem): backend

SaaS multi-tenant e bilíngue (pt/en) para programadores monitorarem os servidores e sites dos clientes deles: no ar/quedas/lentidão, SSL, domínio, e-mails, RAM/CPU/disco, containers, tráfego por país, dependências, pacotes e logs. O cliente final do programador tem um **portal** próprio (vê o sistema dele e paga a mensalidade).

- Site: **https://serverfall.vercel.app** (repo irmão `../managesystem-frontend`, React; push na `main` publica na Vercel).
- API: **https://api-monitor.cestsegtrabalho.com.br/api** (VPS OVH, container `managesystem`).
- `monitor.cestsegtrabalho.com.br` redireciona para o site.
- Nome técnico continua **managesystem** de propósito (repos, banco `managesystem` no cluster Atlas "saas", container, pastas e serviço `managesystem-agent`, User-Agent `ManageSystem-Monitor`). Só textos visíveis viraram "ServerFall"; trocar os técnicos quebra agentes já instalados.

## Estrutura
- MVC por módulo em `src/modules/`: `agente` (recebe dados do agente), `alerta` (Telegram, textos pt/en em `alerta.textos.js`), `assinatura` + `plano` (assinatura da plataforma), `cliente` (telas do super admin), `contratante` (cliente final, faturas), `portal` (API do portal, JWT próprio `${JWT_SECRET}:portal`), `recebimento` (chaves MP/Stripe do programador, cifradas), `monitor` (rotinas: checagem de URL, SSL, domínio, faturas), `servidor`, `site`, `user`, `shared`.
- Mensagens da API em português; tradução em `src/modules/shared/utils/mensagens.en.js` (chave = texto em pt). Mensagem nova → incluir a tradução.
- `agent/agent.mjs` + `agent/install.sh`: o agente que roda nos servidores dos clientes (Node próprio em `/opt/managesystem-agent`, serviço systemd, só lê e envia). **Mudou o agent.mjs? Suba a `const VERSAO`**: os agentes se atualizam sozinhos quando a versão muda. Versão atual: 1.5.1.

## Regras e decisões que não estão no código
- Preços da plataforma **só em dólar**; Pix converte pela cotação (`shared/utils/cambio.js`, cache 1 h).
- Meio de pagamento pelo **país**: Brasil = Mercado Pago (cartão recorrente via preapproval + Pix), fora = Stripe. Vale para programador→plataforma e cliente→programador (o dinheiro do cliente vai direto para a conta do programador).
- `CHAVE_CRIPTOGRAFIA` (cifra as chaves de pagamento dos programadores) é **igual** no `.env` local e no do servidor. Nunca trocar.
- Rotinas do monitor rodam só onde `MONITOR_DESLIGADO` está vazio. Ao testar local, sempre `MONITOR_DESLIGADO=1` (senão duplica alertas).
- Agente: tráfego vem do access log do Caddy/Nginx; sistemas em container de outro servidor são ligados pelo campo `container: { servidorId, nome }` do servidor (cartão mostra RAM/CPU do container, tráfego pelo host da URL). Países pela base gratuita DB-IP (baixada sozinha, `shared/utils/geoip.js`); guarda **só país e contagem** (nunca IP), por 90 dias.
- Botões "Instalar atualizações"/"Reiniciar" do painel: só em servidor cujo agente foi instalado com `--permitir-acoes` (serviço separado `managesystem-acao`; o agente só grava o pedido). Pedem a senha da conta e só admin/super_admin.
- Portal do cliente nunca recebe: custo do servidor, lista de containers da máquina, nome da máquina, botões de ação.

## Banco e testes
- O `.env` local aponta para o **banco de produção**. Prefira leitura; teste com dados temporários (`*.tmp.mjs` na raiz, e-mails `@managesystem-teste.example`) e apague tudo no fim.
- Subir local: `PORT=8081 MONITOR_DESLIGADO=1 node index.js` (a 8080 é a do nodemon dele). Conta do Stanley: tenant `6ac65e4d09947ae27b8347bb` (super_admin, empresa "ServerFall").
- Plano de teste grátis só permite 1 servidor: para teste com 2, crie o segundo direto pelo model.

## Publicar
- `git push` e depois `ssh -i "/home/stanleyandrade/Documents/chaves .pem/ovh/ovh.pem" ubuntu@15.235.101.80 '~/atualizar.sh managesystem'`. Detalhes do VPS (compose, Caddy, `.env` em `~/servidor/env/managesystem.env`): skill `deploy-servidor`.
- Mudou variável de ambiente: editar o `.env` no servidor à mão e rodar o `atualizar.sh`.

## Pendências (só trazer quando ele pedir; lista completa na memória `managesystem-pendencias`)
- Ele precisa dar Stop/Terminate nas 3 EC2 antigas na AWS (managesystem `54.227.151.46`, rara `34.232.16.147`, Sonelia `34.192.26.33`) e liberar os Elastic IPs.
- Portal CNH Fácil: fica desatualizado de propósito (ele está vendendo a manutenção); não mexer.
- rara-backend: trocas de versão grande pendentes (mongoose 9, mongodb 7, dotenv 18, argon2 0.45).
- Stripe com checkout transparente (Elements), bot do Telegram, e-mail pelo Resend: ainda não feitos.
