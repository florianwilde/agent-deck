# Einrichtung Hub (ab Phase 1)

Ziel: Der Hub läuft im Homelab im Normalbetrieb (`HUB_MODE=normal`), kennt den Status aller Cloud-Sessions und gibt ihn über den VPN-Listener an das Stream-Deck-Plugin weiter. Jedes Repo lässt sich mit `agent-deck init` anbinden.

Platzhalter wie in [`setup-phase-0.md`](setup-phase-0.md):

| Platzhalter      | Beispiel                  | Bedeutung                                                    |
| ---------------- | ------------------------- | ------------------------------------------------------------ |
| `hub.example.de` | `agent-deck.example.de`   | Öffentliche Subdomain des Hubs (TLS über NetBird)            |
| `<TOKEN>`        | `3f9c…` (64 Hex-Zeichen)  | Bearer-Token für `POST /events` (Network Secret, wie bisher) |
| `<VPN_TOKEN>`    | `a71e…` (64 Hex-Zeichen)  | Bearer-Token für die VPN-Endpunkte (Plugin), **neu**         |
| `<HUB_IP>`       | `192.168.1.50` / `100.x…` | LAN- oder NetBird-IP des Hubs                                |
| `<CTID>`         | `105`                     | Container-ID (nur Proxmox-Variante)                          |

## Überblick: zwei Listener

| Listener   | Port   | Erreichbar                       | Token           | Endpunkte                                                       |
| ---------- | ------ | -------------------------------- | --------------- | --------------------------------------------------------------- |
| öffentlich | `8787` | Internet, über NetBird-Proxy     | `HUB_TOKEN`     | `POST /events`, `GET /health`                                   |
| VPN        | `8788` | nur im VPN, **nicht** über Proxy | `HUB_VPN_TOKEN` | `GET /state`, `WS /ws`, `POST /sessions/:id/ack`, `GET /health` |

Auf dem öffentlichen Listener gelten außerdem: Body ≤ 4 KB, 60 Requests pro Minute und IP (`HUB_RATE_LIMIT`), unbekannte Felder werden verworfen.

---

## 1. PR mergen

Den Phase-1-PR auf `main` mergen. Ab dann läuft in neuen (und laufenden) Sessions dieses Repos der schlanke Hook `.claude/hooks/agent-deck.sh` statt des Capture-Hooks. Er sendet nur noch Metadaten (Event, Session-ID, Repo, Branch, Zeit, gekürzte Meldung).

## 2. Hub aktualisieren und auf `HUB_MODE=normal` umstellen

### Variante A: Proxmox-LXC

```bash
pct exec <CTID> -- update
pct exec <CTID> -- bash /opt/agent-deck/tools/proxmox/agent-deck-hub.sh normal
```

- `update` holt `main`, baut den Hub neu und aktualisiert dabei den Helfer im Container.
- `normal` setzt in `/etc/agent-deck/hub.env` `HUB_MODE=normal`, erzeugt `HUB_VPN_TOKEN`, setzt `HUB_VPN_HOST=0.0.0.0` und `HUB_VPN_PORT=8788`, kommentiert `HUB_BODY_LIMIT` aus und startet den Dienst neu. `HUB_TOKEN` bleibt gleich, an der Cloud-Umgebung ändert sich also nichts.

VPN-Token anzeigen (für das Plugin in Phase 2):

```bash
pct exec <CTID> -- /usr/local/sbin/agent-deck-hub vpn-token
```

Neue Installationen über den Helper starten direkt im Normalbetrieb mit beiden Tokens.

### Variante B: Docker Compose

```bash
cd agent-deck
git pull
cd packages/hub
openssl rand -hex 32          # Ausgabe = <VPN_TOKEN>
nano .env
```

In `.env` ändern bzw. ergänzen (Vorlage: `.env.example`):

```dotenv
HUB_MODE=normal
HUB_VPN_TOKEN=<VPN_TOKEN>
# IP des Docker-Hosts, die aus dem VPN erreichbar ist (LAN- oder NetBird-IP), nicht 0.0.0.0,
# wenn der Host auch aus dem Internet erreichbar ist.
HUB_VPN_BIND=<HUB_IP>
HUB_VPN_PUBLISH_PORT=8788
```

`HUB_BODY_LIMIT` löschen oder auskommentieren, im Normalbetrieb gilt fest 4 KB. Danach:

```bash
docker compose up -d --build
```

### Prüfen

```bash
curl -s http://<HUB_IP>:8787/health                                  # {"ok":true,"mode":"normal"}
curl -s http://<HUB_IP>:8788/health                                  # {"ok":true,"mode":"normal"}
curl -s http://<HUB_IP>:8788/state -H "Authorization: Bearer <VPN_TOKEN>"   # {"sessions":[…]}
curl -s -o /dev/null -w '%{http_code}\n' http://<HUB_IP>:8788/state  # 401
```

Unter Windows in PowerShell `curl.exe` statt `curl` schreiben, sonst greift der Alias `Invoke-WebRequest` mit anderer Syntax.

Logs: `journalctl -u agent-deck-hub -f` (Variante A) bzw. `docker compose logs -f` (Variante B). Liegen noch Capture-Daten in der Datenbank, steht dort beim Start eine Warnung, siehe Schritt 3.

## 3. Capture-Daten löschen

Die Capture-Daten aus Phase 0 enthalten Prompts, Antworttexte und Datei-Inhalte. Sie liegen in derselben SQLite-Datei wie der neue Session-Stand und werden nicht mehr gebraucht. Am einfachsten löschst du die ganze Datenbank, der Hub legt sie beim Start neu an:

Variante A (LXC, der Container bleibt erhalten):

```bash
pct exec <CTID> -- bash -c 'systemctl stop agent-deck-hub && rm -f /var/lib/agent-deck/agent-deck.db* && systemctl start agent-deck-hub'
```

Variante B (Docker):

```bash
cd agent-deck/packages/hub
docker compose down -v        # löscht Container und Volume mit allen Capture-Daten
docker compose up -d --build
```

Danach erscheint beim Start keine Warnung mehr. Sessions, die gerade laufen, tauchen mit dem nächsten Event wieder auf.

## 4. NetBird: VPN-Listener freigeben, Reverse Proxy unverändert

- **Reverse Proxy:** Der Eintrag für `hub.example.de` zeigt weiter **nur** auf Port `8787`. Port `8788` darf nicht über den Proxy veröffentlicht werden.
- **VPN-Zugriff:** Der Windows-PC mit dem Stream Deck muss `<HUB_IP>:8788` erreichen:
  - Hub als NetBird-Peer (Option „NetBird-Client im Container“ bzw. Docker-Host im NetBird): `<HUB_IP>` ist die NetBird-IP.
  - Oder über einen Routing-Peer ins LAN: `<HUB_IP>` ist die LAN-IP.
  - In den NetBird-Access-Policies den Zugriff vom PC auf TCP `8788` erlauben.

Prüfen vom Windows-PC (PowerShell):

```powershell
curl.exe -s http://<HUB_IP>:8788/state -H "Authorization: Bearer <VPN_TOKEN>"
```

## 5. Cloud-Umgebung

Nichts zu ändern: `AGENT_DECK_URL`, Network Secret (mit `<TOKEN>`) und die Custom-Allowlist aus `setup-phase-0.md` Schritt 3 bleiben. Der VPN-Token gehört **nicht** in die Cloud-Umgebung.

## 6. Test

1. Neue Session auf `florianwilde/agent-deck` (`main`, nur dieses Repo) in der Umgebung starten.
2. `GET /state` (Schritt 2) zeigt die Session mit `"status":"working"` und `"url":"https://claude.ai/code/session_…"`.
3. Prompt: `Stell mir mit AskUserQuestion eine Rückfrage und warte.` → `"status":"needs_input"`, `"lastMessage":"AskUserQuestion"`.
4. Antworten und Claude fertig werden lassen → `"status":"done"`.

Live mitlesen geht auch per WebSocket, z. B. mit `npx wscat -c ws://<HUB_IP>:8788/ws -H "Authorization: Bearer <VPN_TOKEN>"`.

## 7. Weitere Repos anbinden

`agent-deck init` kopiert den Hook nach `.claude/hooks/agent-deck.sh` und trägt ihn in `.claude/settings.json` ein. Fremde Hooks und Einstellungen bleiben erhalten, vorher wird `settings.json.bak` angelegt. Mehrfaches Ausführen ändert nichts.

Am einfachsten in einer Cloud-Session des **Ziel-Repos** (nur dieses Repo auswählen). Prompt:

> Klone `https://github.com/florianwilde/agent-deck` nach `/tmp/agent-deck`, führe dort `pnpm install --filter @agent-deck/cli...` aus und dann im Ziel-Repo `node --conditions=source /tmp/agent-deck/packages/cli/src/index.ts init .`. Lösche `.claude/settings.json.bak`, committe `.claude/settings.json` und `.claude/hooks/agent-deck.sh` und öffne einen PR.

Lokal mit einem Checkout von agent-deck geht es genauso:

```bash
pnpm install
pnpm agent-deck init ../anderes-repo           # eintragen
pnpm agent-deck init --uninstall ../anderes-repo   # nur unsere Einträge entfernen
```

Die Sessions des Ziel-Repos brauchen dieselbe Cloud-Umgebung (`AGENT_DECK_URL`, Network Secret). Sessions mit mehreren Repos laden keine Repo-Hooks und erscheinen deshalb nicht auf dem Stream Deck.

## Konfiguration

| Variable         | Standard               | Bedeutung                                                      |
| ---------------- | ---------------------- | -------------------------------------------------------------- |
| `HUB_MODE`       | `capture`              | `normal` ab Phase 1                                            |
| `HUB_TOKEN`      | –                      | Pflicht, ≥ 32 Zeichen, öffentlicher Listener                   |
| `HUB_VPN_TOKEN`  | –                      | Pflicht im Normalbetrieb, ≥ 32 Zeichen, anders als `HUB_TOKEN` |
| `HUB_HOST`       | `0.0.0.0`              | Bind-Adresse öffentlicher Listener                             |
| `HUB_PORT`       | `8787`                 | Port öffentlicher Listener                                     |
| `HUB_VPN_HOST`   | `127.0.0.1`            | Bind-Adresse VPN-Listener (im Docker-Image `0.0.0.0`)          |
| `HUB_VPN_PORT`   | `8788`                 | Port VPN-Listener                                              |
| `HUB_RATE_LIMIT` | `60`                   | Requests pro Minute und IP auf `POST /events`                  |
| `HUB_DB_PATH`    | `./data/agent-deck.db` | SQLite-Datei                                                   |
| `HUB_BODY_LIMIT` | `262144`               | nur Capture-Modus; im Normalbetrieb fest 4096                  |
| `HUB_LOG_LEVEL`  | `info`                 | Meldungstexte stehen nie im Log, Status-Wechsel auf `info`     |
