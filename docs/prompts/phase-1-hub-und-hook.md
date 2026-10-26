# Phase 1 – Hub, Hook und `agent-deck init`

Lies zuerst `CLAUDE.md`, `docs/cloud-findings.md`, `docs/event-mapping.md` und `docs/progress.md`. Das Mapping aus Phase 0 ist verbindlich.

## Ziel
Der Hub kennt jederzeit den Status aller Cloud-Sessions und schickt jede Änderung per WebSocket raus. Jedes Repo lässt sich mit einem Befehl anbinden.

## Aufgaben

1. **`packages/shared`**: zod-Schemas für `HookEvent` (was der Hook sendet), `Session` (id, repo, url, status, since, lastMessage, queueCount, acknowledged, lastPromptAt) und die WebSocket-Nachrichten (`snapshot`, `session.upsert`, `session.remove`). Status-Enum laut `CLAUDE.md`.
2. **`packages/hub`** (Normalbetrieb, `HUB_MODE=normal`; Capture-Modus aus Phase 0 bleibt erhalten):
   - Öffentlicher Listener: `POST /events` (Token, ≤ 4 KB, Rate-Limit 60/min pro IP, zod-Validierung, unbekannte Felder verwerfen).
   - VPN-Listener (eigene Bind-Adresse/Port aus `.env`): `GET /state`, `WS /ws`, `POST /sessions/:id/ack`, `GET /health`.
   - Status-Engine als reine Funktion `(session, event, now) → session` mit Unit-Tests für jede Zeile in `docs/event-mapping.md`. Timer: 30 Min. ohne Event → `idle`; nach `SessionEnd` 10 Min. später entfernen.
   - Neue Events setzen `acknowledged` zurück.
   - SQLite-Persistenz, damit ein Neustart den Stand behält. Kein Speichern von Inhalten über die Metadaten hinaus.
   - Strukturierte Logs (pino), ohne Token und ohne Meldungstexte im Info-Level.
   - Dockerfile (Node 24, non-root), `docker-compose.yml`, `.env.example`.
3. **`packages/hook/agent-deck.sh`** (ersetzt den Capture-Hook):
   - Liest Payload, baut daraus das schlanke `HookEvent` (nur Felder aus `CLAUDE.md`), sendet per `curl --max-time 2` an `$AGENT_DECK_URL/events`.
   - Nur wenn `CLAUDE_CODE_REMOTE=true`. Immer Exit 0, keine Ausgabe.
   - Ohne `jq` lauffähig, falls Phase 0 gezeigt hat, dass `jq` fehlt.
   - Tests mit `bats` oder als vitest-Test, der das Skript mit Beispiel-Payloads aus `docs/cloud-findings.md` aufruft und gegen einen Fake-Server prüft.
4. **`packages/cli`** – `agent-deck init [pfad]`:
   - Kopiert `agent-deck.sh` nach `.claude/hooks/` und trägt die Hooks in `.claude/settings.json` ein. Bestehende Einstellungen und fremde Hooks bleiben erhalten (Merge, idempotent, Backup `settings.json.bak`).
   - `--uninstall` entfernt nur unsere Einträge.
   - Alle Hooks außer `Stop` mit `async: true`.
   - Tests für Merge-Fälle: leere Datei, vorhandene fremde Hooks, zweimal `init`, `--uninstall`.
5. Den Capture-Hook in **diesem** Repo durch den echten Hook ersetzen (`agent-deck init .`).
6. `docs/setup-hub.md`: Hub-Update im Homelab, Umstellen auf `HUB_MODE=normal`, Anbinden weiterer Repos mit `agent-deck init`.

## Fertig, wenn
- Alle Tests grün.
- Nach dem Mergen erscheint eine neue Cloud-Session dieses Repos in `GET /state` mit richtigem Status, und der Status ändert sich bei Frage → `needs_input`, Ende → `done`.
- `docs/progress.md` aktualisiert, PR offen, Phase angehalten.
