#!/usr/bin/env bash
# Atualiza o backend: baixa o código novo do GitHub, instala as dependências
# e reinicia o serviço. Uso (do notebook):
#   ssh -i "~/Documents/chaves .pem/managesystem/managesystem.pem" ubuntu@IP ./atualizar.sh
set -euo pipefail
cd /home/ubuntu/managesystem-backend

echo "==> Baixando atualizações do GitHub"
antes=$(git rev-parse --short HEAD)
git pull --ff-only
depois=$(git rev-parse --short HEAD)
if [ "$antes" = "$depois" ]; then
  echo "    Já estava na versão mais nova ($depois)"
else
  echo "    $antes -> $depois"
  git log --oneline "$antes..$depois"
fi

echo "==> Instalando dependências"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

echo "==> Reiniciando o backend"
sudo systemctl restart managesystem

echo "==> Conferindo se subiu"
for i in $(seq 1 20); do
  if curl -s -o /dev/null http://127.0.0.1:8080/api/saude; then
    echo "    OK: backend no ar"
    exit 0
  fi
  sleep 1
done

echo "    ERRO: o backend não respondeu. Últimos logs:"
sudo journalctl -u managesystem -n 40 --no-pager
exit 1
