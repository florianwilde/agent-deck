# Fortschritt

Übersichtsseite: <https://claude.ai/artifact/WA2WWawMhNSggxxLnE1Ef8>. Die Daten dafür stehen in `docs/status.json`. Jede Session aktualisiert sie nach ihren Arbeitsschritten, lädt die Datei als Asset der Seite hoch und trägt die neue Asset-URL im Datensatz `tasks` ein.

## Phase 2 – Stream-Deck-Plugin MVP 🟡 (PR offen, Test am Gerät steht aus)

### Fertig

- **`packages/streamdeck-plugin`** mit `@elgato/streamdeck` **3.0.3**: Manifest `de.wildeflorian.agentdeck`, Name „agent-deck“, SDKVersion 3, Stream Deck ≥ 7.1, Node 24, nur Windows. `streamdeck validate` meldet keine Fehler.
- **Renderer** (`src/render/`, per Subagent): `keys.js` nach TypeScript portiert (`projectKey`, `overviewKey`, `commandKey`, `wrapName`, `nameFontSize`, Tokens).
  - Snapshot-Tests vergleichen jeden Zustand aus Screenshot 01 und alle Tasten aus 03 **byte-genau** mit der Ausgabe des unveränderten `keys.js`.
  - Status-Namen und Füllfarben kommen aus `packages/shared`.
  - Neu sind `emptyKey` (freie Taste: nur die dunkle Innenfläche), `formatSince` (m/h/d) und `svgToDataUrl`.
  - Die Vorschau `tools/preview.html` nutzt die TS-Renderer. Den Screenshot `tools/preview.png` habe ich mit Screenshot 01 und 03 verglichen: Geometrie, Farben, Umbrüche und Pillen stimmen. Die Schrift ist in der Sandbox Inter statt Segoe UI.
- **Hub-Client** (`src/hub-client.ts`):
  - `WS /ws` mit `Authorization: Bearer …` im Handshake, Snapshot und Deltas über `WsMessageSchema`.
  - Reconnect mit Backoff 1 s → 30 s. Ohne Verbindung sind alle Slots `OFFLINE · –`.
  - Aus der Hub-URL werden REST- und WS-URL abgeleitet (`http://…:8788`, `…/ws`, `ws(s)://` gehen alle).
  - Getestet gegen einen echten Hub im Normalbetrieb (im Testprozess auf freien Ports): Snapshot, Upserts, `ack`, falscher Token (401), Hub-Neustart.
- **Aktion „Projekt-Slot“** (`src/slots.ts`, `src/deck.ts`, `src/actions/slot.ts`):
  - Automatische Belegung nach Gerät, Zeile, Spalte. Sessions nach Status-Priorität, dann `since` (am längsten wartend zuerst).
  - Feste Belegung per Repo: zeigt die dringendste Session des Repos, bei mehreren `n×`, mit Pin-Punkt. Diese Sessions fallen aus der automatischen Verteilung.
  - Optional fester Rang „n. dringendste Session“ (Feld „Position“ aus Screenshot 04).
  - Kurz drücken öffnet die Session-URL, ohne Session `https://claude.ai/code`. Lang drücken (≥ 600 ms) schickt `POST /sessions/:id/ack` und zeigt Haken oder Warndreieck.
  - Blinken 600 ms bei unquittiertem `needs_input`, Punkte 500 ms bei `working`, Zeit minütlich. Ein Takt von 100 ms berechnet die Bilder, `setImage` geht nur bei Änderung raus.
  - Lokaler Inaktiv-Timeout (10/15/30 Min.) aus den globalen Einstellungen.
- **Property Inspector** (`ui/slot.html`, per Subagent) mit sdpi-components v4.0.1 laut Screenshot 04:
  - Global: Hub-URL, Token, Status live, Öffnen in, Browser, Inaktiv nach, Ton bei Rot, „Verbindung testen“, „Snippet kopieren“.
  - Pro Taste: Belegung, Position, Repo (Liste vom Plugin), Anzeigename.
  - Geprüft mit `tools/pi-check.mjs` gegen eine nachgestellte Stream-Deck-App (18 Prüfungen).
- **End-to-End-Smoke-Test** (`tools/smoke.mjs`): das gebaute `bin/plugin.js`, ein echter Hub-Prozess und eine nachgestellte Stream-Deck-App. Durchgespielt: Taste zeigt die Session → Rot und Blinken bei `PermissionRequest` → Kurzdruck öffnet die Session → Langdruck quittiert → Gelb bei `Stop` → Hub weg ergibt `OFFLINE`. Der Token taucht weder in Nachrichten an Stream Deck noch im Plugin-Log auf.
- **Packen:** `pnpm --filter @agent-deck/streamdeck-plugin run package` erzeugt `dist/de.wildeflorian.agentdeck.streamDeckPlugin` (ca. 220 KB).
  - Der neue Workflow `.github/workflows/plugin-release.yml` baut das Plugin bei jedem PR und legt die Datei als Artefakt ab.
  - Bei einem Tag `plugin-v*` oder einem manuellen Start erstellt er ein Pre-Release mit der Datei.
  - Den Umweg über einen Workflow braucht es, weil die GitHub-Werkzeuge dieser Session kein Release anlegen können und der Git-Proxy den Tag-Push abgelehnt hat.
- **Hub-Fix:**
  - **Problem:** Solange ein WebSocket-Client verbunden war, hing `close()` des VPN-Listeners. Fastify wartet beim Schließen auf offene Verbindungen, der `onClose`-Hook kam zu spät. Folge im Betrieb: `systemctl restart` hätte bei verbundenem Plugin gehangen, bis systemd den Prozess abschießt.
  - **Lösung:** Aufräumen jetzt im `preClose`-Hook, dazu ein Test.
- [`docs/setup-plugin.md`](setup-plugin.md): Installation unter Windows, VPN, Einstellungen, Bedienung, 24 Slots auf dem XL empfohlen (unterste Reihe frei für Phase 3/4), Fehlersuche.
- Tests: 297 grün, davon Plugin 114 (Renderer 77, Belegung, Deck, Hub-Client) und Hub 77 (+1). Lint, Prettier und Typecheck sind grün.

### Nachtrag 0.1.1 (Test am Gerät)

- **Fehler:** Im Property Inspector ließ sich bei „Fest“ kein Repo auswählen, die Liste blieb leer.
- **Ursache:** Stream Deck liefert die Anfrage des Inspectors (`sendToPlugin`) vor `propertyInspectorDidAppear`. Das SDK verwirft Antworten bis zu diesem Ereignis.
- **Fix:** Das Plugin merkt sich solche Anfragen und beantwortet sie beim Erscheinen. Den Status schickt es dabei immer mit.
- **Test:** `tools/smoke.mjs` prüft genau diese Reihenfolge. Vor dem Fix schlug er fehl, jetzt ist er grün.

### Abweichungen von `CLAUDE.md` bzw. dem Phasen-Prompt

| Thema                    | `CLAUDE.md` / Prompt                     | Umgesetzt                                                                                           | Grund                                                                                                                                         |
| ------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK                      | `@elgato/streamdeck` v2                  | v3.0.3 (SDKVersion 3)                                                                               | aktuell; verlangt genau Node 24 und Stream Deck 7.1, wie im Prompt vorgegeben                                                                 |
| Scaffold                 | `streamdeck create`                      | Struktur der CLI-Vorlage (`@elgato/cli` 1.10.3) von Hand nachgebaut, Build mit esbuild statt Rollup | Der Wizard ist interaktiv. esbuild versteht die `.ts`-Importe und die `source`-Bedingung der Workspace-Pakete ohne Zusatz-Plugins.            |
| sdpi-components          | vom CDN (Vorlage)                        | v4.0.1 lokal unter `ui/vendor/` (MIT)                                                               | Der Property Inspector funktioniert so auch ohne Internet. Das CDN war aus der Sandbox nicht erreichbar.                                      |
| Claude-App               | „Browser / Claude-App“                   | beide angeboten, die App versuchsweise mit `claude://claude.ai/code/session_…`                      | Die App hat ein URL-Schema, dokumentiert ist aber kein Link auf eine bestehende Session (siehe `setup-plugin.md`). **Bitte am Gerät testen.** |
| Browser-Auswahl          | Screenshot 04: Feld „Browser“            | nur „Standardbrowser“, deaktiviert                                                                  | `openUrl` öffnet immer den Standardbrowser des Systems                                                                                        |
| Inaktiv nach             | Screenshot 04: „30 Minuten“              | 10, 15 oder 30 Min., wirkt in der Anzeige                                                           | Der Hub setzt fest nach 30 Min. `idle`, längere Werte hätten keine Wirkung                                                                    |
| Property Inspector       | Segment-Buttons, Labels ohne Doppelpunkt | Radio-Buttons, Labels mit Doppelpunkt                                                               | So rendern die sdpi-components (Shadow DOM)                                                                                                   |
| Plugin-Icon              | –                                        | PNG 256/512 (die rote Antwort-Taste), Kategorie- und Aktionssymbol als SVG                          | Das Manifest-Schema verlangt fürs Plugin-Icon PNG                                                                                             |
| Feste Taste ohne Session | –                                        | leere Taste                                                                                         | –                                                                                                                                             |

### Was du (Florian) tun musst

1. **Plugin herunterladen.**
   - Vor dem Merge: im PR unter _Checks → plugin-release → Summary → Artifacts_, als ZIP mit der `.streamDeckPlugin`-Datei.
   - Das Release `plugin-v0.1.0` lege ich nach dem Merge per manuellem Workflow-Start an. Das geht erst, wenn der Workflow auf `main` liegt. Du kannst es auch selbst unter _Actions → plugin-release → Run workflow_ mit `plugin-v0.1.0` starten.
2. Das Plugin nach [`docs/setup-plugin.md`](setup-plugin.md) installieren, die Hub-URL `http://10.1.5.229:8788` und den VPN-Token eintragen und Tasten platzieren.
3. **Am Stream Deck XL testen:**
   - Slots zeigen echte Sessions.
   - **Rot bei Frage**: In einer Session `AskUserQuestion` auslösen. Damit ist auch `needs_input` live geprüft (offen aus Phase 1).
   - Gelb bei fertig, Druck öffnet die Session, Langdruck quittiert (Rot hört auf zu blinken).
   - „Claude-App“ ausprobieren: Öffnet `claude://claude.ai/code/session_…` die Session in der App?
   - „Snippet kopieren“ im Property Inspector: Kommt der Text in der Zwischenablage an?
4. PR prüfen und mergen.

### Offen

- Test am Gerät (siehe oben), dazu Schrift-Breiten mit Segoe UI.
- Ampel, Prompt-Makro, Queue, Blättern und mitgelieferte Profile: Phase 3/4.

## Phase 1 – Hub, Hook und `agent-deck init` ✅ (gemergt, Hub im Normalbetrieb)

### Fertig

- **`packages/shared`**: zod-Schemas `HookEvent`, `Session` und WebSocket-Nachrichten (`snapshot`, `session.upsert`, `session.remove`), dazu Status-Enum mit Priorität und Farben, Timeouts, die Hook-Liste für `init` und `sessionUrl()`. Tests und Typecheck lesen `src/` über die Export-Bedingung `source`, der Build erzeugt `dist/`.
- **`packages/hub`, Normalbetrieb** (`HUB_MODE=normal`). Der Capture-Modus bleibt.
  - **Zwei Listener.** Öffentlich: `POST /events` mit `HUB_TOKEN`, ≤ 4 KB, 60/min pro IP, zod, unbekannte Felder werden verworfen. VPN: `GET /state`, `WS /ws`, `POST /sessions/:id/ack` mit dem neuen **`HUB_VPN_TOKEN`**, dazu je `GET /health`.
  - **Status-Engine** als reine Funktionen (`src/normal/engine.ts`), Tests für jede Zeile in `docs/event-mapping.md`. Ältere Events (nach Hook-Zeitstempel) werden verworfen, neue setzen `acknowledged` zurück.
  - **Timeouts:** `working` → `idle` nach 10 Min., alles → `idle` nach 30 Min. Entfernt wird 10 Min. nach `SessionEnd` und **nach 24 h `idle`**. So verschwinden archivierte Sessions, die kein `SessionEnd` senden.
  - SQLite-Persistenz (Tabelle `sessions`, nur Metadaten). Liegen noch Capture-Daten in der Datei, warnt der Hub beim Start.
  - Logs über pino, ohne Token und ohne Meldungstexte.
  - Dockerfile mit `shared`, Ports 8787/8788. `docker-compose.yml` bindet den VPN-Port an `HUB_VPN_BIND`. `.env.example` ist aktualisiert.
- **`packages/hook/agent-deck.sh`**, umgesetzt per Subagent.
  - Sendet nur `{v, event, sessionId, repo, branch, ts, notificationType, source, message}`.
  - Session-Key ist `CLAUDE_CODE_REMOTE_SESSION_ID`, Repo kommt aus `git remote`, `message` ist auf 120 Zeichen gekürzt.
  - Läuft mit und ohne `jq` mit identischem Ergebnis. Keine Ausgabe, immer Exit 0, `curl --max-time 2`.
  - **In dieser Cloud-Session live bestätigt:** Nach `agent-deck init .` kamen am (noch Capture-)Hub nur noch die schlanken Bodies an, mit `cse_…`, `florianwilde/agent-deck` und Branch.
- **`packages/cli`**, umgesetzt per Subagent.
  - `agent-deck init [pfad]` und `--uninstall`: Merge mit fremden Hooks, idempotent, Backup `settings.json.bak`, atomares Schreiben.
  - Altlasten aus Phase 0 (Capture-Hook, `queue-test.sh`) werden entfernt.
  - Aufruf: `pnpm agent-deck init <pfad>`. Läuft ohne Build, auch mit Node 22.
- **Dieses Repo:** `agent-deck init .` angewendet. In `.claude/` stehen nur noch `settings.json` (10 Events, `Stop` synchron mit `timeout: 5`) und `hooks/agent-deck.sh`. Capture-Hook und `queue-test.sh` sind gelöscht.
- **Proxmox-Helper:**
  - Neue Installationen starten im Normalbetrieb mit beiden Tokens.
  - Neue Befehle im Container: `agent-deck-hub normal` (Umstellung aus Phase 0) und `agent-deck-hub vpn-token`.
  - `update` baut `shared` mit und erneuert den Helfer, mit den bisherigen Ports und dem bisherigen Branch.
  - Behoben: die shellcheck-Meldung SC2015. `pnpm lint:sh` läuft jetzt mit UTF-8-Locale.
- [`docs/setup-hub.md`](setup-hub.md): Update, Umstellung auf `HUB_MODE=normal`, **Capture-Daten löschen** (Schritt 3), NetBird für den VPN-Port, Test, weitere Repos anbinden, alle Variablen.
- Tests: 182 grün (Hub 76, Hook 79, CLI 27). Lint, Typecheck, Prettier, Build und shellcheck sind ebenfalls grün.

### Nicht geprüft

- Den Docker-Build habe ich in der Sandbox nicht vollständig durchlaufen lassen, weil `apt` und das better-sqlite3-Prebuild dort nicht durchs Netz kommen. Geprüft ist `pnpm deploy` mit dem `shared`-Paket: Das Bundle startet im Normalbetrieb.
- Den Container-Teil des Proxmox-Helpers habe ich nur mit Attrappen getestet: `normal` an einer Phase-0-`hub.env` sowie Rendern und shellcheck des Helfers.

### Abweichungen von `CLAUDE.md` bzw. dem Phasen-Prompt

| Thema             | `CLAUDE.md` / Prompt            | Umgesetzt                                                              | Grund                                                                                      |
| ----------------- | ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| VPN-Endpunkte     | nur über Bind-Adresse geschützt | zusätzlich Bearer-Token `HUB_VPN_TOKEN`                                | mit Florian abgestimmt; das Plugin schickt ihn ab Phase 2 mit                              |
| Entfernen         | nach `SessionEnd` 10 Min.       | zusätzlich nach 24 h `idle`                                            | `SessionEnd` kommt in der Cloud nie (Phase 0 B), mit Florian abgestimmt                    |
| `SessionEnd`-Hook | Phase 0: synchron, `timeout: 5` | `async: true` wie alle außer `Stop`                                    | laut `event-mapping.md`; kommt in der Cloud ohnehin nicht                                  |
| Hook-Handler      | –                               | Exec-Form mit `"args": []`                                             | laut Hooks-Doku empfohlen für Pfad-Platzhalter, in Phase 0 in der Cloud bewährt            |
| WebSocket-Upserts | „jede Änderung“                 | ohne reine Zeitstempel-Änderungen (`lastEventAt`)                      | Tool-Events kommen im Sekundentakt, für die Tasten ändert sich dabei nichts                |
| Rate-Limit        | 60/min pro IP                   | 60/min, per `HUB_RATE_LIMIT` änderbar                                  | Capture-Daten: max. 32 Events/min pro Cloud-IP, bei 31 statt jetzt 10 registrierten Events |
| Body-Limit        | ≤ 4 KB                          | im Normalbetrieb fest 4096, `HUB_BODY_LIMIT` gilt nur noch für Capture | eine alte `hub.env` mit 256 KB soll das Limit nicht aushebeln                              |

### Inbetriebnahme (26.10.)

- PR #3 gemergt (von Claude, auf Florians Wunsch).
- Hub (LXC 125) mit `update` auf `b1d3a63` gebracht und mit `agent-deck-hub.sh normal` umgestellt. Die Capture-Datenbank ist gelöscht.
- Von außen geprüft: `/health` meldet `"mode":"normal"`, `/capture` und `/state` geben öffentlich 404, ein ungültiges Event gibt 400.
- Vom Windows-PC über den VPN-Port (`10.1.5.229:8788`) geprüft: `GET /state` liefert diese Cloud-Session mit `cse_`-ID, Repo, Branch, URL und Status `done`. Damit ist die Kette Hook → öffentlicher Listener → Status-Engine → SQLite → VPN-Listener im echten Betrieb bestätigt.
- Nachträglich behoben, Anlass waren Stolpersteine bei der Inbetriebnahme:
  - `agent-deck-hub` war in der Container-Shell nicht im `PATH`. Der Helper legt jetzt einen Link nach `/usr/local/bin` an.
  - In `setup-hub.md` steht jetzt der volle Pfad und der Hinweis auf `curl.exe` in PowerShell.

### Offen

- `needs_input` live: Claude kann den VPN-Port aus der Cloud nicht erreichen. Ein Test braucht deshalb einen Blick auf `/state` vom PC, während eine Session per `AskUserQuestion` fragt. Die Status-Engine dafür ist durch Tests abgedeckt, `PermissionRequest` kommt laut Phase 0 B in der Cloud zuverlässig. Phase 2 zeigt es ohnehin an der Taste.
- Der VPN-Token stand teilweise im Chat (in einer PowerShell-Fehlermeldung). Er gilt nur im VPN. Florian kann ihn erneuern, Befehl siehe unten.

### Was du (Florian) tun kannst

1. Optional den VPN-Token erneuern:
   `sed -i "s/^HUB_VPN_TOKEN=.*/HUB_VPN_TOKEN=$(openssl rand -hex 32)/" /etc/agent-deck/hub.env && systemctl restart agent-deck-hub`, danach `/usr/local/sbin/agent-deck-hub vpn-token`.
2. Phase 2 starten. Den VPN-Token und `http://10.1.5.229:8788` brauchst du für den Property Inspector.

## Phase 0 B – Auswertung ✅ (gemergt)

### Fertig

- Capture-Daten abgerufen: 285 Events aus 5 Cloud-Sessions. Die fehlenden Szenarien aus `setup-phase-0.md` Schritt 5 hat diese Session selbst nachgeholt, mit drei Test-Sessions, die sie gestartet, unterbrochen und archiviert hat.
- [`docs/cloud-findings.md`](cloud-findings.md): Events und Felder, Session-URL, Repo-Name, Notification-Typen, Werkzeuge, Abbruch, Queue-Test. Mit echten Payloads.
- [`docs/event-mapping.md`](event-mapping.md): endgültiges Mapping Event → Status, Timeouts, Hook-Liste für Phase 1.
- Queue-Test: `.claude/hooks/queue-test.sh` (Stop-Hook, synchron) plus Konsistenztest. Ergebnis in `docs/queue-test.md`. Der Hook bleibt vorerst drin und tut nichts, solange `.claude/queue-test-pending` fehlt.

### Ergebnis in Kürze

- **Sprung in die Session funktioniert.** Die URL ist `https://claude.ai/code/session_<id>`, die ID kommt aus env `CLAUDE_CODE_REMOTE_SESSION_ID` (`cse_<id>`). Die Payload-`session_id` ist eine andere UUID.
- **Queue funktioniert.** `{"decision":"block","reason":…}` aus dem Stop-Hook lässt Claude ohne neuen Prompt weiterarbeiten. In der Oberfläche steht dann „Stop hook feedback: <reason>“. Geänderte Hooks wirken sofort, auch in einer laufenden Session.
- **Nicht in der Cloud:** `SessionEnd` (auch nicht beim Archivieren), `idle_prompt` und ein Event nach dem Stopp-Knopf. `StopFailure` ist nur laut Doku belegt.

### Was für die folgenden Phasen gilt

- **Session-Key** ist `CLAUDE_CODE_REMOTE_SESSION_ID`. Fallback ohne die Variable: Payload-`session_id` als Key, die Taste öffnet `https://claude.ai/code`.
- **Repo** aus `git remote get-url origin` (`owner/repo`), Fallback `basename $CLAUDE_PROJECT_DIR`.
- **`needs_input`** kommt aus `PermissionRequest` (sofort) und `Notification`/`permission_prompt` (nach 6 s). In der Cloud fragt praktisch nur `AskUserQuestion` nach, `Bash` und `Write` liefen ohne Freigabe.
- **Ignorieren:**
  - `SubagentStop` ist der Prompt-Vorschlag, der nach fast jedem `Stop` kommt.
  - `Setup` trägt eine fremde `session_id`.
- **Reihenfolge:** Async-Hooks kommen ungeordnet an. Der Hook schickt deshalb seinen eigenen Zeitstempel mit, und der Hub verwirft ältere Events.
- **Timeouts:**
  - `working` → `idle` nach 10 Min. ohne Event, wegen des Abbruchs.
  - Alles → `idle` nach 30 Min., als Ersatz für das fehlende `SessionEnd`.
  - Archivierte Sessions bleiben also als `idle` stehen. Phase 2/4 braucht einen Weg, sie auszublenden (z. B. nach 24 h `idle` oder per Tastendruck).
- **Stop-Hook (Phase 3):**
  - läuft synchron, `timeout` ≤ 5;
  - der Hub markiert ausgelieferte Einträge, damit nichts doppelt kommt;
  - `stop_hook_active: true` ist kein Grund, nicht auszuliefern, Claude Code begrenzt die Kette selbst;
  - der Plattform-Hook `~/.claude/stop-hook-git-check.sh` kann im selben `Stop` zusätzlich blockieren.
- **Body-Größe:** Der echte Hook baut den Body selbst aus wenigen Feldern (≤ 4 KB) und schickt weder Payload noch env weiter.

### Abweichungen von `CLAUDE.md`

| Thema         | `CLAUDE.md`                                 | Ab jetzt                                                                | Grund                                  |
| ------------- | ------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| `needs_input` | nur `Notification`                          | zusätzlich `PermissionRequest`                                          | kommt 6 s früher                       |
| `idle`        | `SessionEnd` oder 30 Min.                   | zusätzlich `working` → `idle` nach 10 Min.                              | `SessionEnd` und Abbruch-Events fehlen |
| `async`       | alle Hooks außer Stop-Ausgabe `async: true` | `Stop` immer synchron                                                   | er muss die Queue abfragen             |
| Session-ID    | –                                           | Key ist `CLAUDE_CODE_REMOTE_SESSION_ID`, nicht die Payload-`session_id` | nur sie ist die Web-ID                 |

### Was du (Florian) tun musst

1. PR prüfen und mergen.
2. **Capture-Daten löschen** (jetzt `docs/setup-hub.md`, Schritt 3). Sie enthalten Prompts und Antworttexte. Bis Phase 1 schickt der Capture-Hook aus jeder Session in diesem Repo weiter alles an den Hub. Wenn du das nicht willst, stoppe den Hub bis dahin.
3. Optional: Die drei archivierten Test-Sessions „agent-deck Capture-Test …“ in claude.ai/code löschen.
4. Phase 1 starten.

## Phase 0 A – Capture-Server und Test-Hook ✅ (gemergt)

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
- `tools/proxmox/agent-deck-hub.sh` ist ein Proxmox-Helper im Stil von community-scripts.org. Es legt einen unprivilegierten Debian-13-LXC an und installiert den Hub darin ohne Docker, mit Node.js 24 und dem systemd-Dienst `agent-deck-hub`. Es erzeugt den Token und bringt `update` mit. Die Prüfung läuft über `pnpm lint:sh` (shellcheck). Was getestet wurde und was nicht, steht in `tools/proxmox/README.md`.
- `docs/setup-phase-0.md` mit der Anleitung für Hub, NetBird, Cloud-Umgebung und Testablauf.

### Was du (Florian) jetzt tun musst

Alles steht in [`docs/setup-phase-0.md`](setup-phase-0.md):

1. Hub im Homelab starten, entweder per Proxmox-Helper (Variante A) oder per `docker compose` (Variante B).
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
