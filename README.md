# ServerFall — Backend (API)

REST API for **ServerFall**, a multi-tenant SaaS that lets developers monitor their clients' servers and websites: uptime, downtime and slowness, SSL, domains, email, RAM/CPU/disk, containers, traffic by country, dependencies, packages and logs. Each developer's end client also gets a **portal** to see their own system and pay the monthly fee.

> The project was formerly called **ManageSystem**. Technical names (repositories, database, container, agent service, User-Agent) keep `managesystem` on purpose, because changing them would break agents that are already installed.

![Node](https://img.shields.io/badge/node-26.13.1-339933?logo=node.js&logoColor=white)
![Fastify](https://img.shields.io/badge/fastify-5-000000?logo=fastify)
![MongoDB](https://img.shields.io/badge/mongodb-mongoose-47A248?logo=mongodb&logoColor=white)
![License](https://img.shields.io/badge/license-private-lightgrey)

## Demo

- **Web app:** https://serverfall.vercel.app (frontend in [`managesystem-frontend`](../managesystem-frontend))
- **API (production):** https://api-monitor.cestsegtrabalho.com.br/api

## Features

- **Accounts and teams:** sign-up with a free trial, JWT login (access + refresh token), "My account" and team members.
- **Servers:** metrics every minute (kept for 31 days), downtime and slowness history, update history and a dashboard per server.
- **Monitoring agent:** a lightweight Node agent installed on each server (systemd service) that only reads and sends data. It updates itself when a new version is released.
- **Containers:** RAM/CPU per container, including systems that run in containers on another server.
- **Traffic by country:** read from the Caddy/Nginx access log, using the free DB-IP database. Only country and count are stored (never the IP), for 90 days.
- **Websites and domains:** URL checks every minute, SSL every 6 hours, domain expiration (RDAP) every 12 hours and email provider (MX).
- **Alerts:** Telegram alerts, with each account choosing what to receive.
- **Remote actions (optional):** "Install updates" and "Restart" buttons, only on servers whose agent was installed with `--permitir-acoes`, and only after confirming the account password.
- **Client portal:** the developer's end client sees their system and invoices and pays the monthly fee directly to the developer.
- **Payments:** prices in US dollars. Brazil uses Mercado Pago (recurring card + Pix converted at the current exchange rate); other countries use Stripe. Developers' payment keys are stored encrypted.
- **Super admin panel:** customers, revenue, extend trial, release or block accounts.
- **Two languages:** Portuguese and English.

## Tech stack

| Area | Technology |
|---|---|
| Runtime | Node.js 26 (ES modules) |
| Framework | Fastify 5 + `@fastify/cors` |
| Database | MongoDB Atlas + Mongoose |
| Auth | argon2, jsonwebtoken |
| Payments | Stripe, Mercado Pago |
| Geolocation | maxmind (DB-IP database) |
| Alerts | Telegram Bot API |
| Agent | Node.js script + bash installer + systemd |

## Prerequisites

- **Node.js 26.13.1** (see `.nvmrc`; with nvm, run `nvm use`)
- **npm**
- Access to a **MongoDB Atlas** cluster
- Optional: Stripe, Mercado Pago and Telegram credentials

## Installation

```bash
git clone <repository-url> managesystem-backend
cd managesystem-backend
nvm use
npm install
cp .env.example .env   # fill in the values
npm run seed           # creates the free trial plan
node scripts/criarSuperAdmin.js you@example.com "StrongPassword123" "Your name"
```

Start the API with the monitoring jobs turned off (otherwise alerts are sent twice when production is also running):

```bash
PORT=8081 MONITOR_DESLIGADO=1 node index.js
```

> ⚠️ **Warning:** use a test database in your `.env` whenever possible.

## Configuration (environment variables)

Never commit the `.env` file. Use placeholder values only in documentation.

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP port (default `8080`) |
| `MONGODB_USERNAME` / `MONGODB_PASSWORD` | Yes | MongoDB Atlas credentials |
| `JWT_SECRET` | Yes | Secret used to sign the tokens (the portal uses a derived secret) |
| `CHAVE_CRIPTOGRAFIA` | Yes | Key that encrypts the developers' payment keys. **Must be the same in every environment and never changed** |
| `APP_URL` | Yes | Frontend URL |
| `APP_URL_BACKEND` | Yes | Public API URL (agent installer and webhooks) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | No | Stripe keys |
| `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` | No | Mercado Pago keys |
| `MP_TEST_PAYER_EMAIL` | No | Test buyer email (Mercado Pago sandbox) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` | No | Telegram bot used for alerts |
| `MONITOR_DESLIGADO` | No | Any value turns the monitoring jobs off (use `1` locally) |

## Usage

### Scripts

| Command | Description |
|---|---|
| `npm start` | Starts the API with nodemon |
| `npm run seed` | Creates the free trial plan |
| `node scripts/criarSuperAdmin.js <email> <password> <name>` | Creates the super admin user |

### Response format

Every route lives under `/api` and returns `{ "success": true, "data": {}, "message": "..." }`. Errors return `success: false` with the proper HTTP status. Messages are translated by the `Accept-Language` header.

### Main modules

| Module | What it does |
|---|---|
| `user` | Sign-up, login, my account, team |
| `plano` / `assinatura` | Platform plans and subscription (Stripe Checkout + Portal, Mercado Pago card and Pix) |
| `servidor` | Servers, metrics, downtime, update history, dashboard |
| `agente` | Agent routes (`/api/agente/coleta`, `/api/agente/inventario`) and installer (`/api/agente/install.sh`) |
| `site` | Domains, SSL, email provider |
| `alerta` | Telegram alerts and alert preferences |
| `monitor` | Scheduled jobs (URL, silent agents, SSL, domains, invoices) |
| `contratante` / `recebimento` | End clients, invoices and the developer's own payment keys |
| `portal` | Client portal API (separate session) |
| `cliente` | Super admin screens |

### Monitoring agent

The agent lives in `agent/` (`agent.mjs` + `install.sh`) and is served by the API itself. When you change `agent.mjs`, **bump the `VERSAO` constant**: installed agents update themselves when the version changes.

## Folder structure

```
managesystem-backend/
├── index.js              # Fastify setup, module registration and jobs
├── agent/                # Monitoring agent and its installer
├── deploy/               # Server setup scripts, systemd unit, Nginx example
├── scripts/              # Seeds and super admin creation
└── src/
    ├── config/           # Stripe and Mercado Pago clients
    ├── db/               # MongoDB connection
    ├── errors/           # AppError(message, status)
    └── modules/
        ├── <entity>/     # model, dto, service, controller, routes
        └── shared/       # middlewares and utils (translations, exchange rate, geoip...)
```

## Deployment

- Runs in a **Docker** container on an **OVH VPS**, behind **Caddy** (HTTPS).
- The server has its own `.env`. When a variable changes, edit it on the server and run the update script.
- After pushing to `main`, update the server:

```bash
~/atualizar.sh managesystem
```

## Contributing

1. Create a branch from `main`: `feature/<name>` (or `fix/<name>`).
2. Follow the module pattern (model, dto, service, controller, routes) and keep business rules in the service.
3. Every query must filter by `tenantId`.
4. Every new API message needs its English translation in `src/modules/shared/utils/mensagens.en.js`.
5. Never expose to the client portal: server cost, the machine's container list, machine name or action buttons.
6. Write commit messages in Portuguese and open a pull request to `main`.

## License and author

**Private and proprietary.** All rights reserved. Copying, distribution or use without authorization is not allowed.

Developed by **Stanley Andrade**.
