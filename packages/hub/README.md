# @agent-deck/hub

Zentraler Dienst: nimmt Hook-Events aus den Cloud-Sessions an, hält den Status und verteilt ihn an das Stream-Deck-Plugin.

## Modi

| `HUB_MODE` | Phase | Inhalt                                                                                                 |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `capture`  | 0     | Speichert jeden `POST /events`-Body unverändert (plus Zeit und Header ohne `Authorization`) in SQLite. |
| `normal`   | ab 1  | Status-Engine, WebSocket, Queue – noch nicht implementiert.                                            |

## Endpunkte im Capture-Modus

| Methode | Pfad                             | Token | Beschreibung                                                                                                           |
| ------- | -------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| `POST`  | `/events`                        | ja    | Body (beliebiger Content-Type, max. `HUB_BODY_LIMIT`) speichern → `202 {"ok":true,"id":n}`                             |
| `GET`   | `/capture?since=<iso>&limit=<n>` | ja    | Einträge nach `since`, älteste zuerst, max. 1000 (`limit` bis 10 000). `body` = Rohtext, `json` = geparst oder `null`. |
| `GET`   | `/health`                        | nein  | `{"ok":true,"mode":"capture"}`                                                                                         |

Token: `Authorization: Bearer <HUB_TOKEN>`.

## Betrieb

```bash
cp .env.example .env    # HUB_TOKEN setzen: openssl rand -hex 32
docker compose up -d --build
curl -s localhost:8787/health
```

Lokal ohne Docker (Node ≥ 24):

```bash
pnpm install
HUB_TOKEN=$(openssl rand -hex 32) HUB_DB_PATH=./data/dev.db node src/index.ts
```

Konfiguration siehe `.env.example`.
