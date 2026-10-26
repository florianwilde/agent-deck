# @agent-deck/hook

Shell-Hooks, die in Ziel-Repos nach `.claude/hooks/` kopiert werden.

| Datei                   | Zweck                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-deck-capture.sh` | Phase 0: schickt den vollständigen Hook-Payload plus gefilterte Umgebungsvariablen an `POST $AGENT_DECK_URL/events` (Hub im Capture-Modus). |
| `agent-deck.sh`         | Ab Phase 1: schlanker Hook, der nur Metadaten an `POST $AGENT_DECK_URL/events` sendet (ersetzt den Capture-Hook).                           |

## Body von `agent-deck.sh`

Vertrag ist `HookEventSchema` in [`packages/shared/src/index.ts`](../shared/src/index.ts). Beispiel:

```json
{
  "v": 1,
  "event": "Notification",
  "sessionId": "cse_01224BkeU5FpJaeMfCorWkYF",
  "repo": "florianwilde/agent-deck",
  "branch": "main",
  "ts": "2026-10-26T13:28:25.123Z",
  "notificationType": "permission_prompt",
  "message": "Claude needs your permission to use AskUserQuestion"
}
```

| Feld               | Quelle                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v`                | immer `1`                                                                                                                                                   |
| `event`            | Payload `hook_event_name` (muss `^[A-Za-z]{1,64}$` erfüllen, sonst wird nichts gesendet; der Hook filtert nicht nach Event-Namen)                           |
| `sessionId`        | env `CLAUDE_CODE_REMOTE_SESSION_ID`, Fallback Payload `session_id` (muss `^[A-Za-z0-9_-]{1,128}$` erfüllen)                                                 |
| `repo`             | `owner/repo` aus `git -C "$CLAUDE_PROJECT_DIR" remote get-url origin` (https, ssh, `git@host:o/r`, Proxy-URLs), ohne Zugangsdaten; Fallback Verzeichnisname |
| `branch`           | `git branch --show-current`, fehlt wenn leer                                                                                                                |
| `ts`               | Zeitpunkt des Hooks, `date -u +%Y-%m-%dT%H:%M:%S.%3NZ` (UTC, ms)                                                                                            |
| `notificationType` | nur `Notification`: `notification_type`                                                                                                                     |
| `source`           | `SessionStart`: `source`, `SessionEnd`: `reason`                                                                                                            |
| `message`          | nur `Notification.message`, `StopFailure.error`, `PermissionRequest.tool_name`; Steuerzeichen werden Leerzeichen, gekürzt auf 120 Zeichen                   |

Optionale Felder fehlen, wenn sie leer sind. Alle anderen Payload-Felder (`prompt`, `tool_input`, `tool_response`, `last_assistant_message`, `cwd`, `transcript_path` …) und die Umgebung werden **nie** gesendet. Der Body ist höchstens 4 KB groß. Ungültiger Payload: kein Request.

Phase 1: Auch der `Stop`-Hook gibt nichts aus. Die Queue-Auslieferung (`{"decision":"block",…}`) kommt in Phase 3.

## Regeln

- Läuft nur, wenn `CLAUDE_CODE_REMOTE=true` und `AGENT_DECK_URL` gesetzt ist.
- Keine Ausgabe, immer Exit 0, `curl --max-time 2`.
- Capture-Hook: Variablen, deren Name `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `AUTH`, `CREDENTIAL`, `COOKIE`, `PRIVATE` oder `EMAIL` enthält, werden nicht gesendet; `user:pass@` in URLs wird entfernt.
- Benötigt `bash` (≥ 4) und `curl`; `jq` wird genutzt, wenn vorhanden, ist aber nicht nötig (Fallback-Parser mit Bash und `sed`, gleiches Ergebnis). `git` und `date` sind optional.
- Der Bearer-Token steht nicht im Skript: Der Cloud-Proxy hängt ihn per Network Secret an.
