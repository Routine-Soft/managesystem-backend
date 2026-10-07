#!/usr/bin/env bash
# Instalador do agente do ManageSystem.
#   Instalar:  curl -fsSL __API_URL__/api/agente/install.sh | sudo bash -s -- --token SEU_TOKEN
#   Remover:   curl -fsSL __API_URL__/api/agente/install.sh | sudo bash -s -- --remover
#
# O agente só LÊ informações da máquina e as envia para a API. Ele roda com o sistema de arquivos em
# modo somente leitura (proteções do systemd), não abre porta e não recebe comandos de fora.
set -euo pipefail

API_URL="__API_URL__"
NODE_MAJOR=22
PASTA_APP=/opt/managesystem-agent
PASTA_DADOS=/var/lib/managesystem-agent
PASTA_CONFIG=/etc/managesystem-agent
SERVICO=managesystem-agent

TOKEN=""
REMOVER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="${2:-}"; shift 2 ;;
    --remover|--uninstall) REMOVER=1; shift ;;
    *) echo "Opção desconhecida: $1"; exit 1 ;;
  esac
done

verde() { printf '\033[32m%s\033[0m\n' "$1"; }
vermelho() { printf '\033[31m%s\033[0m\n' "$1" >&2; }

if [ "$(id -u)" -ne 0 ]; then
  vermelho "Rode com sudo (o agente precisa ser instalado como serviço do sistema)."
  exit 1
fi

if [ "$REMOVER" -eq 1 ]; then
  systemctl disable --now "$SERVICO" 2>/dev/null || true
  rm -f "/etc/systemd/system/$SERVICO.service"
  systemctl daemon-reload
  rm -rf "$PASTA_APP" "$PASTA_DADOS" "$PASTA_CONFIG"
  verde "Agente do ManageSystem removido."
  exit 0
fi

if [ -z "$TOKEN" ]; then
  vermelho "Faltou o token. Copie o comando completo no painel do ManageSystem."
  exit 1
fi

if ! [[ "$TOKEN" =~ ^msa_[A-Za-z0-9_-]+$ ]]; then
  vermelho "Token inválido. Copie o comando completo no painel do ManageSystem."
  exit 1
fi

for programa in curl tar systemctl sha256sum; do
  if ! command -v "$programa" >/dev/null 2>&1; then
    vermelho "Programa necessário não encontrado: $programa"
    exit 1
  fi
done

case "$(uname -m)" in
  x86_64|amd64) ARQ=x64 ;;
  aarch64|arm64) ARQ=arm64 ;;
  armv7l) ARQ=armv7l ;;
  *) vermelho "Processador não suportado: $(uname -m)"; exit 1 ;;
esac

echo "→ Instalando o agente do ManageSystem ($ARQ)..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Node próprio do agente (não mexe no Node que o servidor já tenha). O arquivo é conferido pelo SHA-256 oficial.
BASE_NODE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
curl -fsSL "$BASE_NODE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
ARQUIVO_NODE="$(grep -oE "node-v[0-9.]+-linux-${ARQ}\.tar\.gz" "$TMP/SHASUMS256.txt" | head -n1)"
if [ -z "$ARQUIVO_NODE" ]; then
  vermelho "Não foi possível encontrar o Node para este processador."
  exit 1
fi
echo "→ Baixando $ARQUIVO_NODE..."
curl -fsSL "$BASE_NODE/$ARQUIVO_NODE" -o "$TMP/$ARQUIVO_NODE"
(cd "$TMP" && grep " $ARQUIVO_NODE\$" SHASUMS256.txt | sha256sum -c - >/dev/null)

systemctl stop "$SERVICO" 2>/dev/null || true
rm -rf "$PASTA_APP/node"
mkdir -p "$PASTA_APP/node" "$PASTA_DADOS" "$PASTA_CONFIG"
tar -xzf "$TMP/$ARQUIVO_NODE" -C "$PASTA_APP/node" --strip-components=1

echo "→ Baixando o agente..."
curl -fsSL "$API_URL/api/agente/agent.mjs" -o "$PASTA_DADOS/agent.mjs"

umask 077
cat > "$PASTA_CONFIG/config.json" <<CONFIG
{
  "api": "$API_URL",
  "token": "$TOKEN"
}
CONFIG
chmod 600 "$PASTA_CONFIG/config.json"
chmod 700 "$PASTA_DADOS"

cat > "/etc/systemd/system/$SERVICO.service" <<SERVICE
[Unit]
Description=Agente do ManageSystem (monitoramento do servidor)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$PASTA_APP/node/bin/node $PASTA_DADOS/agent.mjs
Restart=always
RestartSec=10
Nice=10
MemoryMax=256M
CPUQuota=25%
# Proteções: tudo somente leitura, exceto a pasta de dados do próprio agente.
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$PASTA_DADOS
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now "$SERVICO" >/dev/null 2>&1

sleep 5
if systemctl is-active --quiet "$SERVICO"; then
  verde "✔ Agente instalado e rodando. Em até 1 minuto o servidor aparece como Online no painel."
  echo "  Ver o que ele está fazendo: journalctl -u $SERVICO -f"
else
  vermelho "O agente não iniciou. Veja o motivo com: journalctl -u $SERVICO -n 50"
  exit 1
fi
