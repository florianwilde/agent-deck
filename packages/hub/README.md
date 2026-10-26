# @agent-deck/hub

Zentraler Dienst: nimmt Hook-Events aus den Cloud-Sessions an, hält den Status und verteilt ihn an das Stream-Deck-Plugin.

Einrichtung und Umstellung: [`docs/setup-hub.md`](../../docs/setup-hub.md).

## Modi

| `HUB_MODE` | Phase | Inhalt                                                                                                 |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `capture`  | 0     | Speichert jeden `POST /events`-Body unverändert (plus Zeit und Header ohne `Authorization`) in SQLite. |
| `normal`   | ab 1  | Status-Engine, zwei Listener (öffentlich und VPN), WebSocket, SQLite-Persistenz.                       |

## Normalbetrieb

| Listener   | Methode | Pfad                | Token           | Beschreibung                                                                    |
| ---------- | ------- | ------------------- | --------------- | ------------------------------------------------------------------------------- |
| öffentlich | `POST`  | `/events`           | `HUB_TOKEN`     | `HookEvent` (zod, ≤ 4 KB, 60/min pro IP) → `202 {"ok":true}`, `400` bei Fehlern |
| öffentlich | `GET`   | `/health`           | –               | `{"ok":true,"mode":"normal"}`                                                   |
| VPN        | `GET`   | `/state`            | `HUB_VPN_TOKEN` | `{"sessions":[Session…]}`, sortiert nach Status-Priorität                       |
| VPN        | `WS`    | `/ws`               | `HUB_VPN_TOKEN` | erst `snapshot`, dann `session.upsert` / `session.remove`                       |
| VPN        | `POST`  | `/sessions/:id/ack` | `HUB_VPN_TOKEN` | quittiert die Session (`acknowledged: true`), `404` wenn unbekannt              |
| VPN        | `GET`   | `/health`           | –               | wie oben                                                                        |

Token jeweils als `Authorization: Bearer <token>`, auch beim WebSocket-Handshake.

Aufbau (`src/normal/`):

- `engine.ts`: reine Status-Engine `applyEvent(session, event, now)` und `applyTimeouts(session, now)` nach [`docs/event-mapping.md`](../../docs/event-mapping.md). Ältere Events (Hook-Zeitstempel) werden verworfen, neue setzen `acknowledged` zurück. Timeouts: `working` → `idle` nach 10 Min., alles → `idle` nach 30 Min., entfernen 10 Min. nach `SessionEnd` und nach 24 h `idle` (archivierte Sessions senden kein `SessionEnd`).
- `hub.ts`: Stand im Speicher plus SQLite, meldet Änderungen an die WebSocket-Clients. Reine Zeitstempel-Updates (Tool-Events im Sekundentakt) werden gespeichert, aber nicht gesendet.
- `store.ts`: Tabelle `sessions` (nur Metadaten).
- `public.ts`, `vpn.ts`: die beiden Listener.

Logs: pino (JSON). Auf `info` stehen Requests und Status-Wechsel mit Session-ID, Repo und Status, nie Token oder Meldungstexte.

## Capture-Modus (Phase 0)

| Methode | Pfad                             | Token | Beschreibung                                                                                                           |
| ------- | -------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| `POST`  | `/events`                        | ja    | Body (beliebiger Content-Type, max. `HUB_BODY_LIMIT`) speichern → `202 {"ok":true,"id":n}`                             |
| `GET`   | `/capture?since=<iso>&limit=<n>` | ja    | Einträge nach `since`, älteste zuerst, max. 1000 (`limit` bis 10 000). `body` = Rohtext, `json` = geparst oder `null`. |
| `GET`   | `/health`                        | nein  | `{"ok":true,"mode":"capture"}`                                                                                         |

## Betrieb

```bash
cp .env.example .env    # HUB_TOKEN und HUB_VPN_TOKEN setzen: je openssl rand -hex 32
docker compose up -d --build
curl -s localhost:8787/health
```

Lokal ohne Docker (Node ≥ 24):

```bash
pnpm install
HUB_MODE=normal HUB_TOKEN=$(openssl rand -hex 32) HUB_VPN_TOKEN=$(openssl rand -hex 32) \
  HUB_DB_PATH=./data/dev.db node --conditions=source src/index.ts
```

Konfiguration siehe `.env.example` und [`docs/setup-hub.md`](../../docs/setup-hub.md#konfiguration).
