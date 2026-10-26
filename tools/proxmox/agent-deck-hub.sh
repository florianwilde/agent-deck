#!/usr/bin/env bash
# agent-deck Hub – Proxmox-VE-Helper im Stil von community-scripts.org
#
# Auf dem Proxmox-Host (als root) ausführen:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/florianwilde/agent-deck/main/tools/proxmox/agent-deck-hub.sh)"
#
# Legt einen unprivilegierten Debian-LXC an, installiert Node.js 24 und den Hub
# als systemd-Dienst (ohne Docker) und erzeugt einen Bearer-Token.
#
# Im Container:
#   update               Hub auf den neuesten Stand des Branches bringen
#   agent-deck-hub token Token anzeigen
#
# Optionale Umgebungsvariablen (Host):
#   AGENT_DECK_DEFAULTS=1   keine Dialoge, Standardwerte nehmen
#   AGENT_DECK_BRANCH=main  Git-Branch (z. B. ein PR-Branch zum Testen)
#   AGENT_DECK_REPO=…       Git-URL (Standard: github.com/florianwilde/agent-deck)

set -Eeuo pipefail

# ---------------------------------------------------------------------------
# Gemeinsame Einstellungen (werden in den Container übernommen)
# ---------------------------------------------------------------------------
APP="agent-deck Hub"
REPO_URL="${AGENT_DECK_REPO:-https://github.com/florianwilde/agent-deck.git}"
BRANCH="${AGENT_DECK_BRANCH:-main}"
HUB_PORT="${AGENT_DECK_PORT:-8787}"
INSTALL_DIR=/opt/agent-deck
CONF_DIR=/etc/agent-deck
ENV_FILE=/etc/agent-deck/hub.env
DATA_DIR=/var/lib/agent-deck
SERVICE=agent-deck-hub
SVC_USER=agentdeck
NODE_MAJOR=24
NETBIRD_SETUP_KEY=""

# ---------------------------------------------------------------------------
# Ausgabe
# ---------------------------------------------------------------------------
YW=$'\033[33m'
GN=$'\033[1;92m'
RD=$'\033[01;31m'
BL=$'\033[36m'
CL=$'\033[m'

msg_info() { printf ' %s…%s %s\n' "$YW" "$CL" "$1"; }
msg_ok() { printf ' %s✔%s %s\n' "$GN" "$CL" "$1"; }
msg_warn() { printf ' %s!%s %s\n' "$YW" "$CL" "$1"; }
msg_error() { printf ' %s✖%s %s\n' "$RD" "$CL" "$1" >&2; }
die() {
  msg_error "$1"
  exit 1
}

# ===========================================================================
# Teil 1: läuft IM Container
# ===========================================================================

ct_has_systemd() { [ -d /run/systemd/system ]; }

ct_install_packages() {
  msg_info "Pakete installieren"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  # build-essential/python3: für better-sqlite3, falls kein Prebuild passt.
  apt-get install -y -qq curl ca-certificates git openssl gnupg jq build-essential python3 >/dev/null
  msg_ok "Pakete installiert"

  if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
    msg_info "Node.js ${NODE_MAJOR} installieren (NodeSource)"
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
      gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg ||
      die "NodeSource nicht erreichbar (deb.nodesource.com)"
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
      >/etc/apt/sources.list.d/nodesource.list
    apt-get update -qq
    apt-get install -y -qq nodejs >/dev/null
    msg_ok "Node.js $(node --version) installiert"
  fi
  corepack enable
}

ct_build() {
  msg_info "Hub bauen (pnpm install + build)"
  cd "$INSTALL_DIR"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
  pnpm install --frozen-lockfile --filter '@agent-deck/hub...' >/tmp/agent-deck-build.log 2>&1 ||
    die "pnpm install fehlgeschlagen, siehe /tmp/agent-deck-build.log"
  pnpm --filter @agent-deck/hub build >>/tmp/agent-deck-build.log 2>&1 ||
    die "Build fehlgeschlagen, siehe /tmp/agent-deck-build.log"
  msg_ok "Hub gebaut ($(git -C "$INSTALL_DIR" rev-parse --short HEAD) auf ${BRANCH})"
}

ct_write_env() {
  mkdir -p "$CONF_DIR"
  if [ -f "$ENV_FILE" ]; then
    msg_ok "Konfiguration vorhanden, bleibt unverändert (${ENV_FILE})"
    return
  fi
  msg_info "Konfiguration und Token erzeugen"
  umask 027
  cat >"$ENV_FILE" <<EOF
# agent-deck Hub – Konfiguration. Nach Änderungen: systemctl restart ${SERVICE}
HUB_MODE=capture
HUB_TOKEN=$(openssl rand -hex 32)
HUB_HOST=0.0.0.0
HUB_PORT=${HUB_PORT}
HUB_DB_PATH=${DATA_DIR}/agent-deck.db
HUB_BODY_LIMIT=262144
HUB_LOG_LEVEL=info
EOF
  umask 022
  chown root:"$SVC_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  msg_ok "Konfiguration geschrieben (${ENV_FILE})"
}

ct_write_service() {
  cat >"/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=agent-deck Hub
Documentation=https://github.com/florianwilde/agent-deck
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SVC_USER}
Group=${SVC_USER}
EnvironmentFile=${ENV_FILE}
WorkingDirectory=${INSTALL_DIR}/packages/hub
ExecStart=/usr/bin/node ${INSTALL_DIR}/packages/hub/dist/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
}

ct_wait_healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${HUB_PORT}/health" >/dev/null 2>&1; then
      msg_ok "Hub antwortet auf Port ${HUB_PORT}"
      return 0
    fi
    sleep 1
  done
  msg_error "Hub antwortet nicht – Logs: journalctl -u ${SERVICE} -n 50"
  return 1
}

ct_restart() {
  if ct_has_systemd; then
    systemctl daemon-reload
    systemctl enable --now "$SERVICE" >/dev/null 2>&1
    systemctl restart "$SERVICE"
    ct_wait_healthy
  else
    msg_warn "Kein systemd aktiv – Dienst nicht gestartet"
  fi
}

ct_install_netbird() {
  [ -n "$NETBIRD_SETUP_KEY" ] || return 0
  msg_info "NetBird-Client installieren"
  if [ ! -c /dev/net/tun ]; then
    msg_warn "/dev/net/tun fehlt – NetBird übersprungen"
    return 0
  fi
  curl -fsSL https://pkgs.netbird.io/install.sh | sh >/tmp/netbird-install.log 2>&1 ||
    {
      msg_warn "NetBird-Installation fehlgeschlagen, siehe /tmp/netbird-install.log"
      return 0
    }
  netbird up --setup-key "$NETBIRD_SETUP_KEY" >/dev/null 2>&1 ||
    msg_warn "netbird up fehlgeschlagen – später manuell: netbird up --setup-key <KEY>"
  msg_ok "NetBird verbunden ($(netbird status 2>/dev/null | awk -F': ' '/NetBird IP/{print $2}'))"
}

ct_install_helper() {
  # Der Container-Teil liegt als /usr/local/sbin/agent-deck-hub im Container
  # (vom Host per pct push). Nur kopieren, wenn wir aus einer Skriptdatei laufen.
  if [ "$(realpath "$0" 2>/dev/null)" != /usr/local/sbin/agent-deck-hub ]; then
    if [ -f "$0" ] && grep -q 'agent-deck Hub' "$0"; then
      install -m 0755 "$0" /usr/local/sbin/agent-deck-hub
    else
      msg_warn "Helfer nicht installiert (Skript lief nicht aus einer Datei)"
      return 0
    fi
  fi
  printf '#!/bin/sh\nexec /usr/local/sbin/agent-deck-hub update "$@"\n' >/usr/bin/update
  chmod 0755 /usr/bin/update
}

ct_install() {
  ct_install_packages
  id "$SVC_USER" >/dev/null 2>&1 ||
    useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"
  install -d -o "$SVC_USER" -g "$SVC_USER" -m 0750 "$DATA_DIR"

  if [ -d "$INSTALL_DIR/.git" ]; then
    msg_ok "Repo schon vorhanden (${INSTALL_DIR})"
  else
    msg_info "Repo klonen (${BRANCH})"
    git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    msg_ok "Repo geklont"
  fi
  ct_build
  ct_write_env
  ct_write_service
  ct_install_helper
  ct_install_netbird
  ct_restart
}

ct_update() {
  local branch="${1:-$BRANCH}"
  [ -d "$INSTALL_DIR/.git" ] || die "${INSTALL_DIR} fehlt – ist das der agent-deck-Container?"
  msg_info "Update von ${branch} holen"
  local before
  before="$(git -C "$INSTALL_DIR" rev-parse --short HEAD)"
  git -C "$INSTALL_DIR" fetch --quiet --depth 1 origin "$branch"
  git -C "$INSTALL_DIR" reset --quiet --hard FETCH_HEAD
  local after
  after="$(git -C "$INSTALL_DIR" rev-parse --short HEAD)"
  if [ "$before" = "$after" ] && [ "${AGENT_DECK_FORCE:-0}" != 1 ]; then
    msg_ok "Schon aktuell (${after}). Neu bauen erzwingen: AGENT_DECK_FORCE=1 update"
    return
  fi
  msg_ok "${before} → ${after}"
  BRANCH="$branch"
  ct_build
  ct_restart
}

ct_main() {
  [ "$(id -u)" -eq 0 ] || die "Bitte als root ausführen"
  case "${1:-update}" in
  install) ct_install ;;
  update) ct_update "${2:-}" ;;
  token) sed -n 's/^HUB_TOKEN=//p' "$ENV_FILE" ;;
  status)
    systemctl --no-pager status "$SERVICE" || true
    curl -fsS "http://127.0.0.1:${HUB_PORT}/health" && echo
    ;;
  *) die "Unbekannter Befehl: $1 (install | update [branch] | token | status)" ;;
  esac
}

# ===========================================================================
# Teil 2: läuft auf dem Proxmox-HOST
# ===========================================================================

CT_ID=""
CT_HOSTNAME="agent-deck-hub"
CT_CORES=1
CT_RAM=512
CT_SWAP=512
CT_DISK=4
CT_BRIDGE=vmbr0
CT_NET="dhcp"
CT_GW=""
CT_VLAN=""
CT_STORAGE=""
TPL_STORAGE=""
INTERACTIVE=1

header() {
  clear 2>/dev/null || true
  cat <<EOF
${BL}
   __ _  __ _  ___ _ __ | |_      __| | ___  ___| | __
  / _\` |/ _\` |/ _ \ '_ \| __|___ / _\` |/ _ \/ __| |/ /
 | (_| | (_| |  __/ | | | ||___| (_| |  __/ (__|   <
  \__,_|\__, |\___|_| |_|\__|    \__,_|\___|\___|_|\_\\
        |___/                                   Hub · Proxmox LXC
${CL}
EOF
}

host_checks() {
  [ "$(id -u)" -eq 0 ] || die "Bitte als root auf dem Proxmox-Host ausführen"
  if ! command -v pct >/dev/null || ! command -v pveversion >/dev/null; then
    die "Kein Proxmox VE gefunden (pct/pveversion fehlen)"
  fi
  local major
  major="$(pveversion | sed -nE 's#^pve-manager/([0-9]+)\..*#\1#p')"
  [ -n "$major" ] && [ "$major" -ge 8 ] || die "Proxmox VE 8 oder neuer nötig ($(pveversion))"
  [ "$(dpkg --print-architecture)" = amd64 ] || die "Nur amd64 wird unterstützt"
  command -v whiptail >/dev/null || INTERACTIVE=0
  [ -t 0 ] && [ -t 1 ] || INTERACTIVE=0
  [ "${AGENT_DECK_DEFAULTS:-0}" = 1 ] && INTERACTIVE=0
  return 0
}

# Wählt einen Storage mit dem gegebenen Content-Typ; fragt bei mehreren nach.
pick_storage() {
  local content="$1" label="$2"
  local -a list=()
  local name type avail
  # Spalten: Name Type Status Total Used Available % (Größen in KiB)
  while read -r name type _ _ _ avail _; do
    list+=("$name" "${type}, frei $((avail / 1024 / 1024)) GiB")
  done < <(pvesm status -content "$content" 2>/dev/null | awk 'NR>1 && $3=="active"')
  [ "${#list[@]}" -gt 0 ] || die "Kein aktiver Storage für '${content}' gefunden"
  if [ "${#list[@]}" -eq 2 ] || [ "$INTERACTIVE" -eq 0 ]; then
    printf '%s' "${list[0]}"
    return
  fi
  whiptail --title "$APP" --menu "Storage für ${label}:" 16 60 6 "${list[@]}" 3>&1 1>&2 2>&3 ||
    die "Abgebrochen"
}

# Prüft vorab, ob Repo und Branch erreichbar sind (z. B. Tippfehler im Branch).
host_check_repo() {
  command -v git >/dev/null || apt-get install -y -qq git >/dev/null
  GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code --heads "$REPO_URL" "$BRANCH" >/dev/null 2>&1 ||
    die "Branch ${BRANCH} in ${REPO_URL} nicht gefunden"
  msg_ok "Repo erreichbar (${BRANCH})"
}

ask() { # ask <Titel> <Default> → Eingabe
  whiptail --title "$APP" --inputbox "$1" 9 60 "$2" 3>&1 1>&2 2>&3 || die "Abgebrochen"
}

host_settings() {
  CT_ID="$(pvesh get /cluster/nextid)"
  if [ "$INTERACTIVE" -eq 1 ]; then
    local mode
    mode="$(whiptail --title "$APP" --menu "Einstellungen:" 12 60 2 \
      "1" "Standard (${CT_CORES} CPU, ${CT_RAM} MB RAM, ${CT_DISK} GB, DHCP)" \
      "2" "Erweitert" 3>&1 1>&2 2>&3)" || die "Abgebrochen"
    if [ "$mode" = 2 ]; then
      CT_ID="$(ask "Container-ID" "$CT_ID")"
      CT_HOSTNAME="$(ask "Hostname" "$CT_HOSTNAME")"
      CT_CORES="$(ask "CPU-Kerne" "$CT_CORES")"
      CT_RAM="$(ask "RAM in MB" "$CT_RAM")"
      CT_DISK="$(ask "Disk in GB" "$CT_DISK")"
      CT_BRIDGE="$(ask "Netzwerk-Bridge" "$CT_BRIDGE")"
      CT_NET="$(ask "IPv4: 'dhcp' oder statisch in CIDR (z. B. 192.168.1.50/24)" "$CT_NET")"
      if [ "$CT_NET" != dhcp ]; then
        CT_GW="$(ask "Gateway" "$(ip route | awk '/^default/{print $3; exit}')")"
      fi
      CT_VLAN="$(ask "VLAN-Tag (leer = keins)" "")"
      HUB_PORT="$(ask "Hub-Port" "$HUB_PORT")"
      BRANCH="$(ask "Git-Branch" "$BRANCH")"
      if whiptail --title "$APP" --defaultno --yesno \
        "NetBird-Client im Container installieren?\n\nNur nötig, wenn der NetBird-Reverse-Proxy den Hub nicht schon über einen Routing-Peer im LAN erreicht." 12 64; then
        NETBIRD_SETUP_KEY="$(ask "NetBird Setup-Key" "")"
      fi
    fi
  fi
  pct status "$CT_ID" >/dev/null 2>&1 && die "Container-ID ${CT_ID} ist schon vergeben"
  [[ "$CT_ID" =~ ^[0-9]+$ ]] || die "Ungültige Container-ID: ${CT_ID}"
  host_check_repo
  CT_STORAGE="$(pick_storage rootdir "die Container-Disk")"
  TPL_STORAGE="$(pick_storage vztmpl "Templates")"

  if [ "$INTERACTIVE" -eq 1 ]; then
    whiptail --title "$APP" --yesno "Container anlegen?\n
  ID:        ${CT_ID}
  Hostname:  ${CT_HOSTNAME}
  CPU / RAM: ${CT_CORES} / ${CT_RAM} MB
  Disk:      ${CT_DISK} GB auf ${CT_STORAGE}
  Netz:      ${CT_BRIDGE}, ${CT_NET}${CT_VLAN:+, VLAN ${CT_VLAN}}
  Hub:       Port ${HUB_PORT}, Branch ${BRANCH}
  NetBird:   $([ -n "$NETBIRD_SETUP_KEY" ] && echo ja || echo nein)" 18 64 || die "Abgebrochen"
  fi
}

host_template() {
  msg_info "Debian-Template suchen"
  pveam update >/dev/null 2>&1 || msg_warn "pveam update fehlgeschlagen, nutze vorhandene Liste"
  local tpl="" v
  for v in 13 12; do
    tpl="$(pveam available --section system 2>/dev/null | awk '{print $2}' |
      grep -E "^debian-${v}-standard_.*_amd64\.tar\.(zst|gz|xz)$" | sort -V | tail -n1 || true)"
    [ -n "$tpl" ] && break
  done
  [ -n "$tpl" ] || die "Kein Debian-12/13-Template gefunden (pveam available)"
  if ! pveam list "$TPL_STORAGE" 2>/dev/null | grep -q "$tpl"; then
    msg_info "Template ${tpl} herunterladen"
    pveam download "$TPL_STORAGE" "$tpl" >/dev/null
  fi
  TEMPLATE="${TPL_STORAGE}:vztmpl/${tpl}"
  msg_ok "Template ${tpl}"
}

host_create() {
  local net="name=eth0,bridge=${CT_BRIDGE},ip=${CT_NET}"
  [ -n "$CT_GW" ] && net+=",gw=${CT_GW}"
  [ -n "$CT_VLAN" ] && net+=",tag=${CT_VLAN}"
  local -a extra=()
  [ -n "$NETBIRD_SETUP_KEY" ] && extra+=(--dev0 /dev/net/tun)

  msg_info "Container ${CT_ID} anlegen"
  pct create "$CT_ID" "$TEMPLATE" \
    --hostname "$CT_HOSTNAME" \
    --cores "$CT_CORES" --memory "$CT_RAM" --swap "$CT_SWAP" \
    --rootfs "${CT_STORAGE}:${CT_DISK}" \
    --net0 "$net" \
    --unprivileged 1 --features nesting=1 \
    --onboot 1 --ostype debian \
    --tags agent-deck \
    --description "agent-deck Hub – https://github.com/florianwilde/agent-deck" \
    "${extra[@]}" >/dev/null
  msg_ok "Container ${CT_ID} angelegt"

  msg_info "Container starten und auf Netzwerk warten"
  pct start "$CT_ID"
  local i
  for i in $(seq 1 60); do
    pct exec "$CT_ID" -- getent hosts deb.debian.org >/dev/null 2>&1 && break
    [ "$i" -eq 60 ] && die "Container hat kein Netzwerk/DNS (pct enter ${CT_ID} zum Prüfen)"
    sleep 1
  done
  msg_ok "Netzwerk ist da"
}

# Baut den Container-Teil als eigenständiges Skript (Variablen + Funktionen).
render_ct_script() {
  printf '#!/usr/bin/env bash\n# agent-deck Hub – Helfer im Container (erzeugt von tools/proxmox/agent-deck-hub.sh)\nset -Eeuo pipefail\n'
  declare -p REPO_URL BRANCH HUB_PORT INSTALL_DIR CONF_DIR ENV_FILE DATA_DIR SERVICE SVC_USER NODE_MAJOR \
    YW GN RD CL
  # shellcheck disable=SC2016 # bewusst wörtlich: wird erst im Container ausgewertet
  printf 'NETBIRD_SETUP_KEY="${NETBIRD_SETUP_KEY:-}"\n'
  declare -f msg_info msg_ok msg_warn msg_error die \
    ct_has_systemd ct_install_packages ct_build ct_write_env ct_write_service ct_wait_healthy \
    ct_restart ct_install_netbird ct_install_helper ct_install ct_update ct_main
  # shellcheck disable=SC2016
  printf 'ct_main "$@"\n'
}

host_install() {
  local tmp
  tmp="$(mktemp)"
  render_ct_script >"$tmp"
  pct push "$CT_ID" "$tmp" /usr/local/sbin/agent-deck-hub --perms 0755
  rm -f "$tmp"
  # Setup-Key nur als Umgebungsvariable übergeben, nicht ins Skript schreiben.
  pct exec "$CT_ID" -- env NETBIRD_SETUP_KEY="$NETBIRD_SETUP_KEY" /usr/local/sbin/agent-deck-hub install
}

host_summary() {
  local ip token
  ip="$(pct exec "$CT_ID" -- hostname -I 2>/dev/null | awk '{print $1}')"
  token="$(pct exec "$CT_ID" -- /usr/local/sbin/agent-deck-hub token 2>/dev/null)"
  cat <<EOF

 ${GN}${APP} ist eingerichtet.${CL}

   Container:   ${CT_ID} (${CT_HOSTNAME})
   Lokal:       ${BL}http://${ip}:${HUB_PORT}/health${CL}
   Token:       ${YW}${token}${CL}
                (jederzeit: pct exec ${CT_ID} -- agent-deck-hub token)
   Konfig:      ${ENV_FILE} im Container

 Nächste Schritte (docs/setup-phase-0.md, ab Schritt 2):
   1. NetBird-Reverse-Proxy: Subdomain → ${ip}:${HUB_PORT}
   2. Cloud-Umgebung: Network Secret mit dem Token, AGENT_DECK_URL=https://<subdomain>

 Update:  pct exec ${CT_ID} -- update     (oder im Container: update)

EOF
}

host_main() {
  header
  host_checks
  host_settings
  host_template
  host_create
  host_install
  host_summary
}

# ---------------------------------------------------------------------------
# Einstieg: auf dem Host → Container anlegen; im Container → Update/Befehle.
# ---------------------------------------------------------------------------
if [ "${AGENT_DECK_SOURCE_ONLY:-0}" != 1 ]; then
  if command -v pveversion >/dev/null 2>&1; then
    host_main
  else
    ct_main "$@"
  fi
fi
