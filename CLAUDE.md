# agent-deck

Stream-Deck-Plugin, das alle laufenden **Claude-Code-Cloud-Sessions** (claude.ai/code) auf einem **Elgato Stream Deck XL** anzeigt. Jede Session bekommt eine Taste, deren Farbe zeigt, ob Claude arbeitet, eine Antwort braucht, fertig ist oder einen Fehler hat. Ein Tastendruck öffnet die Session. Dazu eine Prompt-Queue und Prompt-Makros, um Folgeaufträge vom Stream Deck einzureihen, ohne Claude zu unterbrechen.

Vorbilder (nur lokal unter Windows, nicht direkt nutzbar): *Claude Deck Windows* (Taste pro Session, Live-Farben, Sprung in die Session) und *Auto Queue for Claude Code* (Prompts einreihen, Auslieferung an Turn-Grenzen).

## Arbeitsweise (immer einhalten)

- Die Umsetzung läuft in **Phasen**. Die Prompts liegen in `docs/prompts/`. Pro Session genau **eine** Phase bearbeiten, die der Nutzer nennt.
- Zu Beginn einer Phase: diese Datei, den Phasen-Prompt und die Ergebnisse früherer Phasen lesen (`docs/cloud-findings.md`, `docs/event-mapping.md`, `docs/progress.md`).
- Erst einen kurzen Plan vorlegen und auf Freigabe warten, dann umsetzen.
- Jede Phase endet mit: Tests grün, `docs/progress.md` aktualisiert (was fertig ist, was offen ist, was der Nutzer manuell tun muss), Commit, Pull Request. Dann **anhalten**, nicht mit der nächsten Phase beginnen.
- Wenn die Doku (Claude Code Hooks, Cloud environments, Elgato SDK) von dieser Datei abweicht, gilt die aktuelle Doku. Abweichung in `docs/progress.md` notieren.
- Commits auf Deutsch oder Englisch, im Stil Conventional Commits (`feat(hub): …`).

## Umgebung

- **Alle Sessions laufen als Claude-Code-Cloud-Sessions** (Anthropic-hosted). Kein lokales Terminal, kein tmux, kein SSH, kein Tippen in Fenster.
- In der Cloud laufen nur Hooks aus der `.claude/settings.json` des **Repos**, nicht aus `~/.claude`. Sessions mit mehreren Repos laden keine Repo-Hooks.
- In Cloud-Sessions ist `CLAUDE_CODE_REMOTE=true` gesetzt.
- Ausgehende Verbindungen nur zu freigegebenen Domains (Cloud-Umgebung, Network access **Custom**). Den Bearer-Token hängt der Cloud-Proxy per **Network Secret** an Requests zur Hub-Domain; er steht nie im Repo und ist in der Session nicht sichtbar.
- Stream Deck XL + Stream-Deck-Software (≥ 7.1) laufen auf Windows.
- Der Hub läuft im Homelab des Nutzers (Proxmox, Docker) und wird über einen **NetBird-Reverse-Proxy** auf einer Subdomain mit TLS veröffentlicht. Das Plugin erreicht den Hub über VPN.
- Plugin-Build und Tests laufen in der Cloud-Session; getestet am echten Gerät wird vom Nutzer unter Windows.

## Architektur

Monorepo, pnpm workspaces, TypeScript `strict`, Tests mit vitest.

| Paket | Inhalt |
| --- | --- |
| `packages/shared` | Event- und State-Typen (zod), Status-Enum, Konstanten |
| `packages/hub` | Node.js + Fastify + `ws` + SQLite (`better-sqlite3`), Dockerfile, `docker-compose.yml` |
| `packages/hook` | `agent-deck.sh` (Bash + curl), wird in Ziel-Repos nach `.claude/hooks/` kopiert |
| `packages/cli` | `agent-deck init` / `--uninstall` für Ziel-Repos |
| `packages/streamdeck-plugin` | `@elgato/streamdeck` v2, Renderer, Aktionen, Property Inspector, Profile |

Hub-Endpunkte:
- **Öffentlich** (über Reverse Proxy, Bearer-Token Pflicht, ≤ 4 KB, Rate-Limit pro IP): `POST /events`, `POST /queue/next`
- **Nur VPN** (eigener Port oder Bind-Adresse): `GET /state`, `WS /ws`, `POST /sessions/:id/ack`, `GET|POST|DELETE /sessions/:id/queue`, `GET|PUT /macros`

## Status-Modell (Priorität absteigend)

| Status | Farbe | Auslöser |
| --- | --- | --- |
| `needs_input` | `#E5484D`, blinkend | `Notification` |
| `done` | `#F5B83D` | `Stop` ohne Queue-Eintrag |
| `error` | `#F76B15` | `StopFailure` |
| `working` | `#30A46C` | `SessionStart`, `UserPromptSubmit`, `PreToolUse`/`PostToolUse` |
| `idle` | `#5B6470` | `SessionEnd` oder 30 Min. kein Event |
| `offline` | `#3A404A` | Plugin hat keine Hub-Verbindung |

Das endgültige Mapping steht nach Phase 0 in `docs/event-mapping.md` und hat Vorrang vor dieser Tabelle.

## Design (verbindlich)

`docs/design/` ist die Vorlage: `DESIGN.md` (Regeln, Farben, Maße), `keys.js` (Referenz-Renderer, nach TypeScript portieren, Geometrie und Farben beibehalten), `screenshots/*.png` (so muss es aussehen), `mockups.html`. Vor jeder UI-Arbeit die Screenshots ansehen.

## Sicherheit und Grenzen

- Hooks senden nur Metadaten: Event, Session-ID, Repo-Name, Zeit, Meldung gekürzt auf 120 Zeichen. **Keine** Prompts, Tool-Inputs, Dateiinhalte oder Code.
- Der Hook darf Claude nie blockieren oder verlangsamen: `curl --max-time 2`, immer Exit 0, keine Ausgabe auf stdout – einzige Ausnahme: der `Stop`-Hook gibt bei einem Queue-Eintrag `{"decision":"block","reason":"<prompt>"}` aus. Alle anderen Hooks `async: true`.
- Queue-Einträge und Makros können nur über die VPN-Endpunkte angelegt werden, nie über den öffentlichen Teil.
- Secrets nie committen. `.env.example` statt `.env`.
- Keine Funktionen, die in ein Terminal tippen (Interrupt, Compact, Clear …) – geht in der Cloud nicht.
