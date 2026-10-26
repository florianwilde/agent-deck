#!/usr/bin/env bash
# agent-deck Capture-Hook (Phase 0).
#
# Schickt den kompletten Hook-Payload (stdin) plus die Umgebungsvariablen an
# "$AGENT_DECK_URL/events", damit wir sehen, was in Cloud-Sessions ankommt.
#
# Regeln: läuft nur bei CLAUDE_CODE_REMOTE=true, gibt nie etwas aus, endet
# immer mit Exit 0 und wartet höchstens 2 s auf den Hub. Variablen, deren Name
# KEY, TOKEN, SECRET, PASSWORD oder AUTH enthält (plus ein paar weitere
# sensible Muster, siehe SENSITIVE), werden nie mitgeschickt. Den
# Bearer-Token hängt der Cloud-Proxy per Network Secret an.

exec >/dev/null 2>&1
trap 'exit 0' ERR

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
[ -n "${AGENT_DECK_URL:-}" ] || exit 0
command -v curl >/dev/null || exit 0

SENSITIVE='KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL|COOKIE|PRIVATE|EMAIL'

payload="$(cat)"

# JSON-String-Escaping ohne jq.
json_string() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  if [[ "$s" == *[$'\001'-$'\037']* ]]; then
    s="$(printf '%s' "$s" | tr -d '\001-\010\013\014\016-\037')"
  fi
  printf '"%s"' "$s"
}

# Zugangsdaten in URLs (https://user:pass@host) entfernen.
strip_userinfo() {
  if [[ "$1" == *://*@* ]]; then
    printf '%s' "$1" | sed -E 's#(://)[^/@[:space:]]+@#\1***@#g'
  else
    printf '%s' "$1"
  fi
}

build_body() {
  local first=1 name value
  printf '{"tool":"%s","payload":' "$1"
  if [ "$1" = "jq" ]; then
    printf '%s' "$payload" | jq -c -R -s '. as $raw | try fromjson catch $raw'
  else
    # Payload ist normalerweise JSON und wird roh eingebettet; sonst als String.
    case "$payload" in
      \{*\}) printf '%s' "$payload" ;;
      *) json_string "$payload" ;;
    esac
  fi
  printf ',"env":{'
  while IFS= read -r name; do
    [[ "${name^^}" =~ $SENSITIVE ]] && continue
    value="$(strip_userinfo "${!name-}")"
    [ $first -eq 1 ] || printf ','
    first=0
    json_string "$name"
    printf ':'
    json_string "$value"
  done < <(compgen -e | LC_ALL=C sort)
  printf '}}'
}

if command -v jq >/dev/null; then tool=jq; else tool=bash; fi
body="$(build_body "$tool")"

printf '%s' "$body" | curl --silent --show-error --max-time 2 \
  -X POST -H 'Content-Type: application/json' \
  --data-binary @- "${AGENT_DECK_URL%/}/events" >/dev/null || true

exit 0
