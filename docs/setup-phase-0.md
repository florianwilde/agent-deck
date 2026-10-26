# Einrichtung Phase 0 – Capture-Test

Ziel: Der Hub läuft im Capture-Modus im Homelab, eine Cloud-Session dieses Repos schickt jedes Hook-Event dorthin, und in Teil B werten wir aus, was angekommen ist.

Platzhalter in dieser Anleitung:

| Platzhalter      | Beispiel                     | Bedeutung                                         |
| ---------------- | ---------------------------- | ------------------------------------------------- |
| `hub.example.de` | `agent-deck.wildeflorian.de` | Öffentliche Subdomain des Hubs (TLS über NetBird) |
| `<TOKEN>`        | `3f9c…` (64 Hex-Zeichen)     | Bearer-Token des Hubs                             |

> **Wichtig:** Cloud-Sessions laufen bei Anthropic, nicht in deinem VPN. Die Hub-Subdomain muss deshalb **aus dem Internet** erreichbar sein (über den NetBird-Reverse-Proxy). Geschützt ist sie durch den Bearer-Token. In Phase 1 bekommen die nur für das Plugin gedachten Endpunkte einen eigenen, nur im VPN erreichbaren Listener.

> **Datenschutz:** Im Capture-Modus speichert der Hub die **vollständigen** Hook-Payloads, also auch deine Prompts, Tool-Eingaben (z. B. Bash-Befehle, Datei-Inhalte bei `Write`) und Claudes Antworttexte – nur für dieses Repo und nur für die Testphase. Nach Teil B löschen wir die Daten (Schritt 7).

---

## 1. Hub im Homelab starten

Zwei Wege, beide ergeben denselben Hub. Variante A ist die einfachere.

### Variante A: Proxmox-LXC per Helper-Skript (empfohlen)

Wie bei community-scripts.org: In der **Shell des Proxmox-Hosts** (Web-UI → Node → Shell, als root) ausführen:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/florianwilde/agent-deck/main/tools/proxmox/agent-deck-hub.sh)"
```

> Das Skript liegt erst nach dem Merge des Phase-0-A-PRs auf `main`. Den PR kannst du gefahrlos zuerst mergen: Ohne `AGENT_DECK_URL` tut der Hook nichts. Zum Testen vor dem Merge den Branch angeben und das Skript von dort laden:
> `AGENT_DECK_BRANCH=<branch> bash -c "$(curl -fsSL https://raw.githubusercontent.com/florianwilde/agent-deck/refs/heads/<branch>/tools/proxmox/agent-deck-hub.sh)"`

Das Skript

1. fragt **Standard** (1 CPU, 512 MB RAM, 4 GB Disk, DHCP auf `vmbr0`) oder **Erweitert** ab. Unter Erweitert lassen sich CT-ID, Hostname, Ressourcen, statische IP, VLAN, Port und Branch einstellen, außerdem optional der NetBird-Client im Container.
2. lädt das neueste Debian-13-Template (Fallback Debian 12) und legt einen **unprivilegierten** LXC mit Autostart an,
3. installiert darin Node.js 24 (NodeSource), klont das Repo nach `/opt/agent-deck` und baut den Hub,
4. erzeugt `/etc/agent-deck/hub.env` mit `HUB_MODE=capture` und einem frischen Token (`openssl rand -hex 32`),
5. richtet den systemd-Dienst `agent-deck-hub` ein (läuft als User `agentdeck`, Daten in `/var/lib/agent-deck`),
6. zeigt am Ende **IP, Port und Token** an.

Den Token später erneut anzeigen: `pct exec <CTID> -- agent-deck-hub token`. Ein Update holst du mit `pct exec <CTID> -- update`, im Container genügt `update`. Logs: `journalctl -u agent-deck-hub -f`. Ohne Dialoge, mit Standardwerten: `AGENT_DECK_DEFAULTS=1` voranstellen.

Prüfen (im Container oder aus dem LAN mit `<IP>` statt `localhost`):

```bash
curl -s http://localhost:8787/health      # {"ok":true,"mode":"capture"}
```

### Variante B: Docker Compose

Auf einem Docker-Host (Proxmox-VM/LXC mit Docker und Docker Compose v2):

```bash
git clone https://github.com/florianwilde/agent-deck.git
cd agent-deck/packages/hub
cp .env.example .env
openssl rand -hex 32          # Ausgabe = <TOKEN>, gut aufheben (Passwortmanager)
nano .env                     # HUB_TOKEN=<TOKEN> eintragen, HUB_MODE=capture lassen
docker compose up -d --build
```

Prüfen:

```bash
docker compose ps                         # Status "healthy" nach ca. 30 s
curl -s http://localhost:8787/health      # {"ok":true,"mode":"capture"}
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8787/events -d '{}'
                                          # 401 (ohne Token)
curl -s -X POST http://localhost:8787/events \
  -H "Authorization: Bearer <TOKEN>" -H 'Content-Type: application/json' \
  -d '{"test":"lokal"}'                   # {"ok":true,"id":1}
```

Falls Port 8787 belegt ist: in `.env` `HUB_PUBLISH_PORT=<anderer Port>` setzen und `docker compose up -d` erneut ausführen.

Die Daten liegen im Docker-Volume `hub_hub-data` (SQLite unter `/data/agent-deck.db` im Container).

## 2. NetBird-Reverse-Proxy-Eintrag anlegen

Im NetBird-Dashboard einen Reverse-Proxy-Dienst für die Subdomain anlegen:

1. **Domain:** `hub.example.de` (DNS-Eintrag zeigt auf den NetBird-Proxy, TLS-Zertifikat automatisch).
2. **Ziel:** der Hub, Port `8787` (bzw. `HUB_PUBLISH_PORT`), Protokoll HTTP. Dafür gibt es zwei Möglichkeiten:
   - Der Hub ist selbst ein NetBird-Peer. Bei Variante A geht das über die Option „NetBird-Client im Container“ mit Setup-Key, bei Variante B über den Docker-Host.
   - Ein vorhandener NetBird-Routing-Peer im LAN leitet zur LAN-IP des Hubs weiter.
3. **Zugriff:** öffentlich (ohne NetBird-Login/SSO vor dem Dienst), denn die Cloud-Sessions sind keine NetBird-Peers. Die Authentifizierung macht der Hub per Bearer-Token.
4. Falls der Proxy einen Header wie `X-Forwarded-For` setzt: gut, der Hub wertet ihn aus (`trustProxy`) und speichert ihn mit.

Von außerhalb des VPNs (z. B. Handy im Mobilfunk) prüfen:

```bash
curl -s https://hub.example.de/health     # {"ok":true,"mode":"capture"}
```

## 3. Claude-Cloud-Umgebung einstellen

Auf [claude.ai/code](https://claude.ai/code) im Umgebungs-Auswahlfeld (unter dem Eingabefeld) die Umgebung öffnen, in der dieses Repo laufen soll – am besten eine eigene Umgebung **„agent-deck“** anlegen (**Add environment**), damit andere Repos unberührt bleiben. Im Dialog **Edit cloud environment**:

### 3a. Network access → Custom

1. **Network access** auswählen → **Custom**.
2. **Allowed domains:** eine Zeile `hub.example.de`.
3. Haken bei **Also include default list of common package managers** setzen (npm, PyPI usw. für spätere Phasen).

### 3b. Environment variables

```
AGENT_DECK_URL=https://hub.example.de
```

Kein abschließender Schrägstrich nötig (wird ignoriert). **Den Token hier nicht eintragen** – Umgebungsvariablen kann jeder lesen, der die Umgebung nutzt.

### 3c. Network secret

1. Zeile **Network secrets** auswählen → **Add secret**.
2. **Secret type:** **Bearer** (Standard).
3. **Name:** `agent-deck hub`.
4. **Allowed websites:** `hub.example.de`.
5. **Custom headers:** Name `Authorization`, Prefix `Bearer`, Value `<TOKEN>`.
6. **Add** – das Secret wird sofort gespeichert. Danach den Dialog mit **Save changes** schließen (für 3a und 3b).

Team-Plan ohne Admin-Rolle: Das Formular ist kürzer – **Host** `hub.example.de`, **Secret type** **Token**, **Value** `<TOKEN>`.

Wenn das Secret in der Liste mit **Not sent** markiert ist, steht darunter der Grund.

### 3d. Verbindung prüfen

Neue Session in der Umgebung starten (beliebiges Repo) und Claude bitten:

> Führe `curl -s "$AGENT_DECK_URL/health"` und `curl -s -X POST "$AGENT_DECK_URL/events" -H 'Content-Type: application/json' -d '{"test":"cloud"}'` aus und zeig mir die Ausgabe.

Erwartet: `{"ok":true,"mode":"capture"}` und `{"ok":true,"id":…}`. Ein `401` heißt: Das Network Secret greift nicht (Host oder Header prüfen). Ein Verbindungsfehler heißt: Domain nicht freigegeben oder Reverse Proxy nicht erreichbar.

## 4. PR mergen

Den Phase-0-A-PR auf `main` mergen. Erst dann enthält eine neue Session die Hook-Konfiguration (`.claude/settings.json`, `.claude/hooks/agent-deck-capture.sh`).

## 5. Test-Session durchspielen

Eine **neue** Session auf `florianwilde/agent-deck` (Branch `main`) in der Umgebung aus Schritt 3 starten. **Nur dieses eine Repo** auswählen – Sessions mit mehreren Repos laden keine Repo-Hooks.

Notiere zu jedem Schritt grob die Uhrzeit, das hilft in Teil B beim Zuordnen. Notiere außerdem die **Session-URL** aus der Adresszeile (`https://claude.ai/code/session_…`).

| #   | Was du tust                                                                                                                                                                          | Was wir sehen wollen                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | Erster Prompt: `Lies CLAUDE.md und fasse sie in zwei Sätzen zusammen.`                                                                                                               | `SessionStart`, `UserPromptSubmit`, `InstructionsLoaded`, `PreToolUse`/`PostToolUse` (Read), `Stop`      |
| 2   | `Stell mir eine Rückfrage, welche Datei du anlegen sollst, und warte auf meine Antwort.` → dann **mind. 2 Minuten nicht antworten**, danach antworten: `docs/capture-test.md`        | `Stop` nach der Frage, ggf. `Notification` (`idle_prompt` nach ~60 s)                                    |
| 3   | Permission-Modus oben auf **Manual** stellen, dann: `Lege docs/capture-test.md mit dem Inhalt "Capture-Test" an.` → Rechte-Abfrage **mind. 30 Sekunden** offen lassen, dann erlauben | `PermissionRequest`, `Notification` (`permission_prompt` nach ~6 s), `PreToolUse`/`PostToolUse` (Write)  |
| 4   | `Führe den Befehl "cat /gibt-es-nicht" aus.`                                                                                                                                         | `PostToolUseFailure`                                                                                     |
| 5   | `Starte einen Subagenten, der die Dateien in packages/ zählt.`                                                                                                                       | `SubagentStart`, `SubagentStop`                                                                          |
| 6   | Eine längere Aufgabe starten (`Schreibe einen ausführlichen Absatz über jedes Paket in packages/ in docs/capture-test.md.`) und mittendrin den **Stopp-Knopf** drücken               | Was nach einem Abbruch kommt (laut Doku kein `Stop`)                                                     |
| 7   | Fehler provozieren: `/model gibt-es-nicht` eingeben und danach einen Prompt senden. Falls das sofort abgelehnt wird, ist das auch ein Ergebnis – dann weiter.                        | `StopFailure` bzw. was sonst passiert                                                                    |
| 8   | `/compact` eingeben                                                                                                                                                                  | `PreCompact`, `PostCompact`, `SessionStart` (`source: compact`)                                          |
| 9   | `/clear` eingeben, dann ein kurzer Prompt `Sag hallo.`                                                                                                                               | `SessionEnd` (`reason: clear`), neues `SessionStart` (`source: clear`) – bleibt die `session_id` gleich? |
| 10  | Session beenden: in der Seitenleiste über **⋯ → Archive** archivieren                                                                                                                | Ob `SessionEnd` kommt                                                                                    |

Nicht committen oder PR erstellen lassen – die Testdatei ist egal.

## 6. Einträge abrufen (Kontrolle)

Aus dem VPN oder von überall (Token nötig):

```bash
curl -s -H "Authorization: Bearer <TOKEN>" \
  "https://hub.example.de/capture?since=2026-10-26T00:00:00Z" \
  | jq '{count, events: ([.entries[].json.payload.hook_event_name | select(. != null)] | group_by(.) | map({(.[0]): length}) | add)}'
```

Erwartet: eine Zählung pro Event-Typ. Wenn `count` 0 ist: Schritt 3d wiederholen und prüfen, ob die Session wirklich nur dieses Repo hatte und auf `main` (mit gemergtem PR) lief.

Danach Teil B in einer neuen Session starten:

```
Lies CLAUDE.md und führe docs/prompts/phase-0-machbarkeit.md aus, Teil B. Die Einrichtung aus docs/setup-phase-0.md ist erledigt.
```

Gib dabei gern Session-URL und Uhrzeiten aus Schritt 5 mit. Die Teil-B-Session kann `GET /capture` selbst abrufen, weil das Network Secret auch für sie den Token anhängt.

## 7. Nach Teil B aufräumen

Die Capture-Daten enthalten Prompts und Code. Wenn Teil B fertig ist:

Variante A (LXC, der Container bleibt für Phase 1 erhalten):

```bash
pct exec <CTID> -- bash -c 'systemctl stop agent-deck-hub && rm -f /var/lib/agent-deck/agent-deck.db* && systemctl start agent-deck-hub'
```

Variante B (Docker):

```bash
cd agent-deck/packages/hub
docker compose down -v        # löscht Container und Volume mit allen Capture-Daten
```

In Phase 1 wird der Hub auf `HUB_MODE=normal` umgestellt (Anleitung dann in `docs/setup-hub.md`). Token und Cloud-Umgebung bleiben gleich.
