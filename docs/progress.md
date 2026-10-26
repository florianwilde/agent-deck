# Fortschritt

## Phase 0 A – Capture-Server und Test-Hook ✅ (PR offen)

### Fertig

- Monorepo-Gerüst: pnpm workspaces, TypeScript strict, vitest, ESLint (flat config, `typescript-eslint` strict), Prettier. Pakete `shared`, `hub`, `hook`, `cli`, `streamdeck-plugin` angelegt (`shared`, `cli`, `streamdeck-plugin` nur mit README).
- `packages/hub` im Capture-Modus (`HUB_MODE=capture`):
  - `POST /events` speichert den Body unverändert als Rohtext, dazu Zeitstempel, IP und Header ohne `Authorization`, `Proxy-Authorization`, `Cookie`. Bearer-Token ist Pflicht.
  - `GET /capture?since=<iso>&limit=<n>` liefert die Einträge (Rohtext und geparstes JSON). Bearer-Token ist Pflicht.
  - `GET /health` ohne Token.
  - Dockerfile (Node 24, non-root, Healthcheck), `docker-compose.yml` (benanntes Volume), `.env.example`.
  - Das Image wurde in der Session gebaut und gestartet. Ablauf `401 → 202 → /capture` liefert den Eintrag. Der Container läuft als `node`.
- `packages/hook/agent-deck-capture.sh`:
  - Sendet `{tool, payload, env}` an `$AGENT_DECK_URL/events`.
  - Läuft nur bei `CLAUDE_CODE_REMOTE=true` und gesetzter URL. Keine Ausgabe, immer Exit 0, `curl --max-time 2`.
  - Funktioniert mit und ohne `jq` (`tool` sagt, welcher Weg lief).
- Dieses Repo: `.claude/settings.json` und `.claude/hooks/agent-deck-capture.sh` registrieren den Hook für 31 Events.
- Tests (23): Hub-Endpunkte, Token, Body-Limit, `since`-Filter, Config. Hook gegen einen Fake-Server mit und ohne `jq`: Filterung, kein Request lokal, Timeout bei hängendem Hub. Dazu ein Konsistenztest für `.claude/settings.json`.
- `docs/setup-phase-0.md` mit der Anleitung für Hub, NetBird, Cloud-Umgebung und Testablauf.

### Was du (Florian) jetzt tun musst

Alles steht in [`docs/setup-phase-0.md`](setup-phase-0.md):

1. Hub per `docker compose` im Homelab starten.
2. NetBird-Reverse-Proxy für die Subdomain anlegen, öffentlich erreichbar.
3. Cloud-Umgebung einstellen: Custom-Netzwerk, Network Secret, `AGENT_DECK_URL`.
4. Diesen PR mergen.
5. Test-Session nach der Tabelle in Schritt 5 durchspielen.
6. Teil B starten.

### Offen für Teil B

- Echte Payloads auswerten und `docs/cloud-findings.md` sowie `docs/event-mapping.md` schreiben.
- Den Queue-Test mit einem Stop-Hook und `.claude/queue-test-pending` durchführen.

### Abweichungen von `CLAUDE.md` bzw. dem Phasen-Prompt

| Thema            | `CLAUDE.md` / Prompt                                   | Umgesetzt                                                                      | Grund                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook-Events      | 8 Events                                               | 31 von 33 Events aus der [Hooks-Doku](https://code.claude.com/docs/en/hooks)   | Der Prompt verlangt „alle Events, die die aktuelle Doku nennt“. **Nicht registriert** sind `WorktreeCreate` und `WorktreeRemove`, weil ein Hook dort das git-worktree-Verhalten komplett ersetzt und einen Pfad zurückgeben muss. `FileChanged` beobachtet nur `CLAUDE.md`, weil der Matcher dort die Watch-Liste bildet. |
| `async`          | alle Hooks `async: true`                               | alle außer `SessionEnd`                                                        | `SessionEnd` hat ein Budget von 1,5 s, und laufende async-Hooks können beim Beenden abgebrochen werden. Deshalb läuft dieser Hook synchron mit `timeout: 5`. Er blockiert Claude nicht, die Session endet ohnehin.                                                                                                        |
| Body-Größe       | ≤ 4 KB                                                 | Capture-Modus: 256 KB (`HUB_BODY_LIMIT`)                                       | Payload plus `env` ist schon ohne Tool-Ausgaben ca. 8 KB groß. Die 4-KB-Grenze gilt ab Phase 1 für `HUB_MODE=normal`.                                                                                                                                                                                                     |
| Öffentlich / VPN | `GET /capture` nicht spezifiziert                      | `GET /capture` hängt am selben (öffentlichen) Listener, mit Token              | Im Capture-Modus gibt es nur einen Listener. So kann die Teil-B-Session die Daten über das Network Secret selbst abrufen. Die Trennung in zwei Listener kommt in Phase 1.                                                                                                                                                 |
| env-Filter       | Namen mit `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `AUTH` | zusätzlich `CREDENTIAL`, `COOKIE`, `PRIVATE`, `EMAIL` und `user:pass@` in URLs | Vorsorglich. Ein Test mit dem echten env dieser Cloud-Session zeigte keine Token-Werte im Body.                                                                                                                                                                                                                           |
| TypeScript       | –                                                      | 6.0 statt 7.0                                                                  | `typescript-eslint` 8.72 unterstützt nur TypeScript < 6.1.                                                                                                                                                                                                                                                                |

### Erste Erkenntnisse aus Doku und dieser Session (in Teil B bestätigen)

- **Session-URL:** Laut [Doku](https://code.claude.com/docs/en/cloud-environments) liefert `CLAUDE_CODE_REMOTE_SESSION_ID` die Session-ID mit Präfix `cse_`. Die URL ist `https://claude.ai/code/session_<rest>`. In dieser Session passt das: `cse_01BivHDCdsD9iWM4PWsvZqaZ` gehört zu `https://claude.ai/code/session_01BivHDCdsD9iWM4PWsvZqaZ`. Daneben gibt es `CLAUDE_CODE_SESSION_ID`, eine UUID. Vermutlich ist das die Hook-`session_id`, also **nicht** die Web-ID.
- **Werkzeuge:** In dieser Cloud-Session sind `jq` 1.7, `curl` 8.5.0 und `bash` 5.2 vorhanden.
- **Network Secret:** Hosts eines Secrets sind laut Doku auch ohne Allowlist erreichbar. Die Domain steht trotzdem in der Custom-Liste, als Absicherung.
- **Notification-Typen** laut Doku:
  - `permission_prompt` kommt erst nach ca. 6 s. Ein sofortiges Signal liefert `PermissionRequest`.
  - `idle_prompt` kommt ca. 60 s nach dem Ende von Claudes Antwort.
  - Weitere Typen: `auth_success`, `elicitation_dialog`, `elicitation_url_dialog`, `elicitation_complete`, `elicitation_response`, `agent_needs_input`, `agent_completed`, `quota_auto_resume_*`, `plugin_notification`.
- **Stop-Hook (wichtig für Phase 3):**
  - `stop_hook_active` ist `true`, wenn Claude schon wegen eines Stop-Hooks weiterarbeitet.
  - Nach 8 Fortsetzungen in Folge beendet Claude Code den Turn trotzdem. Der Zähler wird bei jedem Tool-Aufruf zurückgesetzt und lässt sich über `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` ändern.
  - Bei einem Abbruch durch den Nutzer kommt kein `Stop`. Bei API-Fehlern kommt `StopFailure` mit `error` (`rate_limit`, `overloaded`, …).
- **SessionEnd** liefert `reason` (`clear`, `resume`, `logout`, `prompt_input_exit`, `other`).
- **Docker-Build in der Cloud-Sandbox:** Der Build braucht dort das Proxy-CA-Zertifikat. Ich habe mit einer temporären Dockerfile-Kopie und `--build-context` gebaut. Im Homelab ist das nicht nötig.
