#!/usr/bin/env bash
# agent-deck Hook (ab Phase 1).
#
# Liest den Hook-Payload (stdin), nimmt daraus nur Metadaten und schickt sie
# als ein kleines JSON an "$AGENT_DECK_URL/events":
#
#   {"v":1,"event":"…","sessionId":"…","repo":"owner/repo","branch":"…",
#    "ts":"…","notificationType":"…","source":"…","message":"…"}
#
# Vertrag: HookEventSchema in packages/shared/src/index.ts. Prompts,
# Tool-Inputs, Tool-Antworten, Antworttexte, Pfade und env werden nie
# gesendet. "message" ist nur Notification.message, StopFailure.error oder
# PermissionRequest.tool_name, gekürzt auf 120 Zeichen.
#
# Regeln: läuft nur bei CLAUDE_CODE_REMOTE=true und gesetztem AGENT_DECK_URL,
# gibt nie etwas aus, endet immer mit Exit 0 und wartet höchstens 2 s auf den
# Hub. Nutzt jq, wenn vorhanden, sonst einen kleinen Parser in Bash/sed. Den
# Bearer-Token hängt der Cloud-Proxy per Network Secret an.

exec >/dev/null 2>&1

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
[ -n "${AGENT_DECK_URL:-}" ] || exit 0
command -v curl >/dev/null || exit 0

# Byte-genaue Verarbeitung; UTF-8 wird unten von Hand behandelt.
export LC_ALL=C

MESSAGE_MAX=120
SHORT_MAX=64
NAME_MAX=200
BODY_MAX=4096
# Rohwerte werden vor dem Dekodieren hierauf gekürzt (reicht für 120 Zeichen).
RAW_MAX=4096

payload="$(cat)"
[ -n "$payload" ] || exit 0

# --- Hilfsfunktionen --------------------------------------------------------

# JSON-String-Escaping (Steuerzeichen sind vorher schon ersetzt).
json_string() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

# Steuerzeichen (inkl. Zeilenumbrüche, Tabs, DEL) durch Leerzeichen ersetzen.
sanitize() {
  local s="$1"
  s="${s//[$'\001'-$'\037'$'\177']/ }"
  printf '%s' "$s"
}

# Auf $2 Unicode-Zeichen kürzen, ohne ein UTF-8-Zeichen zu zerschneiden.
truncate_utf8() {
  local s="$1" max="$2" i=0 count=0 c
  if [ "${#s}" -le "$max" ]; then
    printf '%s' "$s"
    return
  fi
  while [ "$i" -lt "${#s}" ]; do
    c="${s:i:1}"
    if [[ "$c" != [$'\200'-$'\277'] ]]; then
      count=$((count + 1))
      [ "$count" -le "$max" ] || break
    fi
    i=$((i + 1))
  done
  printf '%s' "${s:0:i}"
}

# Bereinigen und kürzen.
clean() {
  local s
  s="$(sanitize "$1")"
  truncate_utf8 "$s" "$2"
}

# Unicode-Codepoint als UTF-8 ausgeben.
utf8_char() {
  local cp="$1" hex
  if [ "$cp" -lt 128 ]; then
    printf -v hex '\\x%02x' "$cp"
  elif [ "$cp" -lt 2048 ]; then
    printf -v hex '\\x%02x\\x%02x' $((0xC0 | cp >> 6)) $((0x80 | (cp & 0x3F)))
  elif [ "$cp" -lt 65536 ]; then
    printf -v hex '\\x%02x\\x%02x\\x%02x' $((0xE0 | cp >> 12)) \
      $((0x80 | (cp >> 6 & 0x3F))) $((0x80 | (cp & 0x3F)))
  else
    printf -v hex '\\x%02x\\x%02x\\x%02x\\x%02x' $((0xF0 | cp >> 18)) \
      $((0x80 | (cp >> 12 & 0x3F))) $((0x80 | (cp >> 6 & 0x3F))) $((0x80 | (cp & 0x3F)))
  fi
  printf '%b' "$hex"
}

# JSON-String-Token ("…" inkl. Anführungszeichen) dekodieren.
json_decode() {
  local s="${1:0:RAW_MAX}" out="" c hex cp lo
  s="${s#\"}"
  s="${s%\"}"
  while [[ "$s" == *\\* ]]; do
    out+="${s%%\\*}"
    s="${s#*\\}"
    c="${s:0:1}"
    s="${s:1}"
    case "$c" in
      '"' | \\ | /) out+="$c" ;;
      b | f | n | r | t) out+=' ' ;;
      u)
        hex="${s:0:4}"
        [[ "$hex" =~ ^[0-9A-Fa-f]{4}$ ]] || continue
        s="${s:4}"
        cp=$((16#$hex))
        if [ "$cp" -ge 55296 ] && [ "$cp" -le 56319 ] && [[ "$s" =~ ^\\u([dD][c-fC-F][0-9A-Fa-f]{2}) ]]; then
          lo=$((16#${BASH_REMATCH[1]}))
          s="${s:6}"
          cp=$((65536 + ((cp - 55296) << 10) + (lo - 56320)))
        elif [ "$cp" -ge 55296 ] && [ "$cp" -le 57343 ]; then
          cp=65533
        fi
        if [ "$cp" -lt 32 ] || [ "$cp" -eq 127 ]; then
          out+=' '
        else
          out+="$(utf8_char "$cp")"
        fi
        ;;
      *) ;; # ungültiges Escape: weglassen
    esac
  done
  printf '%s' "$out$s"
}

# --- Payload lesen ------------------------------------------------------------

event="" payload_session="" cwd="" notification_type="" source="" reason=""
message="" error="" tool_name=""

parse_with_jq() {
  local -a f
  mapfile -t f < <(printf '%s' "$payload" | jq -r '
    if type != "object" then error("kein Objekt") else . end
    | [.hook_event_name, .session_id, .cwd, .notification_type, .source,
       .reason, .message, .error, .tool_name]
    | map(if type == "string"
        then .[0:1000] | explode | map(if . < 32 or . == 127 then 32 else . end) | implode
        else "" end)
    | .[]') || return 1
  [ "${#f[@]}" -eq 9 ] || return 1
  event="${f[0]}" payload_session="${f[1]}" cwd="${f[2]}"
  notification_type="${f[3]}" source="${f[4]}" reason="${f[5]}"
  message="${f[6]}" error="${f[7]}" tool_name="${f[8]}"
}

# Ohne jq: Payload mit sed in Tokens zerlegen (ein Token pro Zeile), dann die
# String-Felder der obersten Ebene herausziehen. Verschachtelte Werte
# (tool_input, tool_response …) werden übersprungen.
parse_with_bash() {
  local -a tokens
  local tok depth=0 key="" have_key=0 candidate="" started=0 finished=0
  local -A raw=()
  mapfile -t tokens < <(printf '%s\n' "$payload" |
    sed -E 's/"([^"\\]|\\.)*"/\n&\n/g' |
    sed -E '/^"/{
      s/^(.{'"$RAW_MAX"'}).+$/\1"/
      b
    }
    s/"/\n!\n/g
    s/[][{}:,]/\n&\n/g' |
    sed -E '/^"/!{
      s/^[[:space:]]+//
      s/[[:space:]]+$//
    }
    /^$/d')
  for tok in "${tokens[@]}"; do
    [ "$finished" -eq 0 ] || return 1
    case "$tok" in
      '{' | '[')
        if [ "$started" -eq 0 ]; then
          [ "$tok" = '{' ] || return 1
          started=1
        fi
        have_key=0 candidate=""
        depth=$((depth + 1))
        ;;
      '}' | ']')
        [ "$started" -eq 1 ] || return 1
        have_key=0 candidate=""
        depth=$((depth - 1))
        [ "$depth" -ge 0 ] || return 1
        [ "$depth" -gt 0 ] || finished=1
        ;;
      ':')
        if [ "$depth" -eq 1 ]; then
          key="${candidate#\"}"
          key="${key%\"}"
          have_key=1
          candidate=""
        fi
        ;;
      ',') have_key=0 candidate="" ;;
      '"'*)
        [ "$started" -eq 1 ] || return 1
        if [ "$depth" -eq 1 ]; then
          if [ "$have_key" -eq 1 ]; then
            [ -z "$key" ] || raw[$key]="$tok"
            have_key=0
          else
            candidate="$tok"
          fi
        fi
        ;;
      true | false | null | -[0-9]* | [0-9]*)
        [ "$started" -eq 1 ] || return 1
        have_key=0
        ;;
      *) return 1 ;;
    esac
  done
  [ "$finished" -eq 1 ] || return 1

  local name value
  for name in hook_event_name session_id cwd notification_type source reason message error tool_name; do
    [ -n "${raw[$name]+x}" ] || continue
    value="$(json_decode "${raw[$name]}")"
    value="$(sanitize "${value:0:RAW_MAX}")"
    case "$name" in
      hook_event_name) event="$value" ;;
      session_id) payload_session="$value" ;;
      cwd) cwd="$value" ;;
      notification_type) notification_type="$value" ;;
      source) source="$value" ;;
      reason) reason="$value" ;;
      message) message="$value" ;;
      error) error="$value" ;;
      tool_name) tool_name="$value" ;;
    esac
  done
}

if command -v jq >/dev/null; then
  parse_with_jq || exit 0
else
  parse_with_bash || exit 0
fi

[[ "$event" =~ ^[A-Za-z]{1,64}$ ]] || exit 0

session_id="${CLAUDE_CODE_REMOTE_SESSION_ID:-$payload_session}"
[[ "$session_id" =~ ^[A-Za-z0-9_-]{1,128}$ ]] || exit 0

# --- Repo und Branch ----------------------------------------------------------

project_dir="${CLAUDE_PROJECT_DIR:-$cwd}"

# owner/repo aus einer Remote-URL: https://host/o/r.git, git@host:o/r.git,
# ssh://git@host/o/r, http://127.0.0.1:1234/git/o/r. Zugangsdaten fallen weg.
repo_from_url() {
  local url="$1" owner name
  url="${url%%[?#]*}"
  url="${url%/}"
  url="${url%.git}"
  url="${url#*://}"
  url="${url#*@}"
  name="${url##*[/:]}"
  url="${url%[/:]*}"
  owner="${url##*[/:]}"
  [ "$owner" != "$url" ] || return 1
  [[ "$owner" =~ ^[A-Za-z0-9._-]+$ && "$name" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
  printf '%s/%s' "$owner" "$name"
}

repo="" branch=""
if [ -n "$project_dir" ] && command -v git >/dev/null; then
  export GIT_TERMINAL_PROMPT=0
  origin="$(git -C "$project_dir" remote get-url origin 2>/dev/null)" || origin=""
  [ -z "$origin" ] || repo="$(repo_from_url "$origin")" || repo=""
  branch="$(git -C "$project_dir" branch --show-current 2>/dev/null)" || branch=""
fi
if [ -z "$repo" ] && [ -n "$project_dir" ]; then
  repo="${project_dir%/}"
  repo="${repo##*/}"
fi
repo="$(clean "$repo" "$NAME_MAX")"
branch="$(clean "$branch" "$NAME_MAX")"
[ -n "$repo" ] || exit 0

# --- Zeitstempel --------------------------------------------------------------

ts_ok() { [[ "$1" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$ ]]; }
ts="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ 2>/dev/null)" || ts=""
ts_ok "$ts" || ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" || ts=""
if ! ts_ok "$ts"; then
  # Ohne date: Bash-Builtins (EPOCHREALTIME ab Bash 5).
  export TZ=UTC0
  now="${EPOCHREALTIME:-}"
  if [[ "$now" =~ ^([0-9]+)[.,]([0-9]{3}) ]]; then
    printf -v ts '%(%Y-%m-%dT%H:%M:%S)T.%sZ' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
  else
    printf -v ts '%(%Y-%m-%dT%H:%M:%S)TZ' -1
  fi
fi
ts_ok "$ts" || exit 0

# --- Felder je Event ----------------------------------------------------------

note_type="" src="" msg=""
case "$event" in
  Notification)
    note_type="$notification_type"
    msg="$message"
    ;;
  SessionStart) src="$source" ;;
  SessionEnd) src="$reason" ;;
  StopFailure) msg="$error" ;;
  PermissionRequest) msg="$tool_name" ;;
esac
note_type="$(clean "$note_type" "$SHORT_MAX")"
src="$(clean "$src" "$SHORT_MAX")"
msg="$(clean "$msg" "$MESSAGE_MAX")"

# --- Senden -------------------------------------------------------------------

body="{\"v\":1,\"event\":$(json_string "$event"),\"sessionId\":$(json_string "$session_id")"
body+=",\"repo\":$(json_string "$repo")"
[ -z "$branch" ] || body+=",\"branch\":$(json_string "$branch")"
body+=",\"ts\":$(json_string "$ts")"
[ -z "$note_type" ] || body+=",\"notificationType\":$(json_string "$note_type")"
[ -z "$src" ] || body+=",\"source\":$(json_string "$src")"
[ -z "$msg" ] || body+=",\"message\":$(json_string "$msg")"
body+="}"
[ "${#body}" -le "$BODY_MAX" ] || exit 0

printf '%s' "$body" | curl --silent --max-time 2 \
  -X POST -H 'Content-Type: application/json' \
  --data-binary @- -o /dev/null "${AGENT_DECK_URL%/}/events" || true

exit 0
