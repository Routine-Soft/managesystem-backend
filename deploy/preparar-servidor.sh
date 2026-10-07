#!/usr/bin/env bash
# Prepara uma EC2 Ubuntu nova para o ManageSystem (rodar UMA vez, no servidor).
#   bash preparar-servidor.sh <url-do-repositorio-git> <dominio-da-api> <email-para-o-certbot>
# Exemplo:
#   bash preparar-servidor.sh git@github.com:stanley/managesystem-backend.git api-monitor.cestsegtrabalho.com.br stanley@email.com
# Antes: o DNS do domínio já precisa apontar para o IP desta EC2 (senão o certbot falha).
# Depois: copiar o .env para /home/ubuntu/managesystem-backend/.env e rodar ~/atualizar.sh.
set -euo pipefail

REPO="${1:?Informe a URL do repositório}"
DOMINIO="${2:?Informe o domínio da API}"
EMAIL="${3:?Informe o e-mail para o certbot}"
PASTA=/home/ubuntu/managesystem-backend

echo "==> Pacotes do sistema"
sudo apt-get update -qq
sudo apt-get install -y -qq nginx certbot python3-certbot-nginx git curl

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi

echo "==> Código"
if [ ! -d "$PASTA/.git" ]; then
  git clone "$REPO" "$PASTA"
fi
cd "$PASTA"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
cp deploy/atualizar.sh /home/ubuntu/atualizar.sh
chmod +x /home/ubuntu/atualizar.sh

echo "==> Serviço systemd"
sudo cp deploy/managesystem.service /etc/systemd/system/managesystem.service
sudo systemctl daemon-reload
sudo systemctl enable managesystem

echo "==> Nginx"
sed "s/__DOMINIO__/$DOMINIO/" deploy/nginx.conf | sudo tee /etc/nginx/sites-available/managesystem >/dev/null
sudo ln -sf /etc/nginx/sites-available/managesystem /etc/nginx/sites-enabled/managesystem
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "==> HTTPS (certbot)"
sudo certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos -m "$EMAIL" --redirect

if [ -f "$PASTA/.env" ]; then
  sudo systemctl restart managesystem
  echo "Pronto: https://$DOMINIO/api/saude"
else
  echo "Falta o .env: copie para $PASTA/.env (com APP_URL_BACKEND=https://$DOMINIO) e rode ~/atualizar.sh"
fi
