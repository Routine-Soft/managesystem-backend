#!/usr/bin/env bash
# Instalador do agente do ManageSystem.
#   Instalar:  curl -fsSL __API_URL__/api/agente/install.sh | sudo bash -s -- --token SEU_TOKEN
#   Remover:   curl -fsSL __API_URL__/api/agente/install.sh | sudo bash -s -- --remover
#
# O agente só LÊ informações da máquina e as envia para a API. Ele roda com o sistema de arquivos em
# modo somente leitura (proteções do systemd), não abre porta e não executa comandos.
#
# Opcional: --permitir-acoes libera os botões "Instalar atualizações" e "Reiniciar" do painel. Eles são
# executados por um serviço separado (managesystem-acao), que só conhece essas duas ações fixas; o agente
# apenas deixa o pedido na pasta dele. Sem a opção (ou com --sem-acoes), esse serviço não existe.
set -euo pipefail

API_URL="__API_URL__"
NODE_MAJOR=22
PASTA_APP=/opt/managesystem-agent
PASTA_DADOS=/var/lib/managesystem-agent
PASTA_CONFIG=/etc/managesystem-agent
SERVICO=managesystem-agent

TOKEN=""
REMOVER=0
ACOES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="${2:-}"; shift 2 ;;
    --remover|--uninstall) REMOVER=1; shift ;;
    --permitir-acoes) ACOES=1; shift ;;
    --sem-acoes) ACOES=0; shift ;;
    *) echo "Opção desconhecida: $1"; exit 1 ;;
  esac
done

verde() { printf '\033[32m%s\033[0m\n' "$1"; }
vermelho() { printf '\033[31m%s\033[0m\n' "$1" >&2; }

if [ "$(id -u)" -ne 0 ]; then
  vermelho "Rode com sudo (o agente precisa ser instalado como serviço do sistema)."
  exit 1
fi

remover_acoes() {
  systemctl disable --now managesystem-acao.path 2>/dev/null || true
  rm -f /etc/systemd/system/managesystem-acao.path /etc/systemd/system/managesystem-acao.service "$PASTA_APP/acao.sh" "$PASTA_CONFIG/acoes-permitidas"
}

if [ "$REMOVER" -eq 1 ]; then
  systemctl disable --now "$SERVICO" 2>/dev/null || true
  remover_acoes
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

# Ações do painel (opcional): o agente grava o pedido em $PASTA_DADOS/acoes/pedido e o systemd chama o
# script abaixo, que aceita só "atualizar" e "reiniciar" e devolve o resultado na mesma pasta.
mkdir -p "$PASTA_DADOS/acoes"
chmod 700 "$PASTA_DADOS/acoes"
if [ "$ACOES" -eq 1 ]; then
  cat > "$PASTA_APP/acao.sh" <<'ACAO'
#!/usr/bin/env bash
# Executa UMA ação pedida pelo painel do ManageSystem. Só existem duas, fixas: atualizar e reiniciar.
set -uo pipefail
PASTA=/var/lib/managesystem-agent/acoes
PEDIDO="$PASTA/pedido"
[ -f "$PEDIDO" ] || exit 0
ID="" ; TIPO=""
read -r ID TIPO < "$PEDIDO" || true
rm -f "$PEDIDO"
[[ "$ID" =~ ^[a-f0-9]{24}$ ]] || exit 0
STATUS="$PASTA/resultado-$ID.status"
LOG="$PASTA/resultado-$ID.log"
case "$TIPO" in
  atualizar)
    echo executando > "$STATUS"
    export DEBIAN_FRONTEND=noninteractive
    if { apt-get -q -o DPkg::Lock::Timeout=600 update && \
         apt-get -y -q -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade; } > "$LOG" 2>&1; then
      [ -f /var/run/reboot-required ] && echo "*** É preciso reiniciar o servidor para concluir algumas atualizações." >> "$LOG"
      echo ok > "$STATUS"
    else
      echo erro > "$STATUS"
    fi
    ;;
  reiniciar)
    echo "Reiniciando o servidor a pedido do painel." > "$LOG"
    echo ok > "$STATUS"
    sync
    systemctl reboot
    ;;
esac
exit 0
ACAO
  chmod 700 "$PASTA_APP/acao.sh"
  cat > /etc/systemd/system/managesystem-acao.service <<UNIDADE
[Unit]
Description=ManageSystem: ação pedida pelo painel (instalar atualizações ou reiniciar)

[Service]
Type=oneshot
ExecStart=$PASTA_APP/acao.sh
TimeoutStartSec=1800
UNIDADE
  cat > /etc/systemd/system/managesystem-acao.path <<UNIDADE
[Unit]
Description=ManageSystem: espera pedidos de ação do painel

[Path]
PathExists=$PASTA_DADOS/acoes/pedido
Unit=managesystem-acao.service

[Install]
WantedBy=multi-user.target
UNIDADE
  touch "$PASTA_CONFIG/acoes-permitidas"
else
  remover_acoes
fi

systemctl daemon-reload
systemctl enable --now "$SERVICO" >/dev/null 2>&1
[ "$ACOES" -eq 1 ] && systemctl enable --now managesystem-acao.path >/dev/null 2>&1

sleep 5
if systemctl is-active --quiet "$SERVICO"; then
  verde "✔ Agente instalado e rodando. Em até 1 minuto o servidor aparece como Online no painel."
  [ "$ACOES" -eq 1 ] && verde "✔ Botões \"Instalar atualizações\" e \"Reiniciar\" liberados para este servidor."
  echo "  Ver o que ele está fazendo: journalctl -u $SERVICO -f"
else
  vermelho "O agente não iniciou. Veja o motivo com: journalctl -u $SERVICO -n 50"
  exit 1
fi
