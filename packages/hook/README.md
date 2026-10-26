# @agent-deck/hook

Shell-Hooks, die in Ziel-Repos nach `.claude/hooks/` kopiert werden.

| Datei                   | Zweck                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-deck-capture.sh` | Phase 0: schickt den vollständigen Hook-Payload plus gefilterte Umgebungsvariablen an `POST $AGENT_DECK_URL/events` (Hub im Capture-Modus). |
| `agent-deck.sh`         | Ab Phase 1: schlanker Hook, der nur Metadaten sendet (ersetzt den Capture-Hook).                                                            |

## Regeln

- Läuft nur, wenn `CLAUDE_CODE_REMOTE=true` und `AGENT_DECK_URL` gesetzt ist.
- Keine Ausgabe, immer Exit 0, `curl --max-time 2`.
- Variablen, deren Name `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `AUTH`, `CREDENTIAL`, `COOKIE`, `PRIVATE` oder `EMAIL` enthält, werden nicht gesendet; `user:pass@` in URLs wird entfernt.
- Benötigt `bash` und `curl`; `jq` wird genutzt, wenn vorhanden, ist aber nicht nötig.
- Der Bearer-Token steht nicht im Skript: Der Cloud-Proxy hängt ihn per Network Secret an.
