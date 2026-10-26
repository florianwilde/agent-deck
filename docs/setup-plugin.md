# Einrichtung Stream-Deck-Plugin (ab Phase 2)

Das Plugin zeigt die Cloud-Sessions als Tasten auf dem Stream Deck XL. Es verbindet sich über das VPN mit dem **VPN-Listener** des Hubs (`http://10.1.5.229:8788`, siehe [`setup-hub.md`](setup-hub.md)).

## Voraussetzungen

- Windows 10 oder 11, Stream-Deck-Software **7.1 oder neuer**. Node.js musst du nicht installieren, Stream Deck bringt Node 24 für Plugins mit.
- NetBird verbunden: `http://10.1.5.229:8788/health` muss im Browser `{"ok":true,"mode":"normal"}` zeigen.
- Den VPN-Token (`HUB_VPN_TOKEN`) zur Hand haben: im Hub-Container `/usr/local/sbin/agent-deck-hub vpn-token`.

## 1. Installieren

1. Die Datei **`de.wildeflorian.agentdeck.streamDeckPlugin`** herunterladen:
   - vom GitHub-Release `plugin-v0.1.0` (Releases rechts auf der Repo-Seite), sobald es angelegt ist;
   - vor dem Merge aus dem Pull Request: _Checks → plugin-release → Summary → Artifacts_. GitHub liefert sie als ZIP, darin liegt die Datei.
2. Doppelklick auf die Datei. Stream Deck fragt nach und installiert das Plugin.
3. In der Aktionsliste rechts erscheint die Kategorie **agent-deck** mit der Aktion **Projekt-Slot**.

Update: neue Datei herunterladen und wieder doppelklicken. Einstellungen und Tasten bleiben erhalten.
Deinstallieren: in Stream Deck unter _Einstellungen → Plugins → agent-deck → Deinstallieren_.

## 2. Tasten platzieren

Das Stream Deck XL hat 32 Tasten (8 Spalten × 4 Reihen).

- Ziehe **Projekt-Slot** auf so viele Tasten, wie du Sessions sehen willst. Die Tasten füllen sich automatisch nach Dringlichkeit: erst `ANTWORT` (rot), dann `FERTIG` (gelb), `FEHLER` (orange), `ARBEITET` (grün), `INAKTIV` (grau). Bei gleichem Status steht vorn, wer am längsten wartet.
- Die Reihenfolge der Tasten ist Zeile für Zeile von links oben nach rechts unten. Die erste Slot-Taste zeigt also die dringendste Session.
- **Empfehlung:** die oberen drei Reihen mit Slots belegen, also **24 Slots**. Die unterste Reihe bleibt frei für Ampel, Prompt-Makros, Queue und Blättern, die in Phase 3 und 4 dazukommen. Brauchst du sie nicht, gehen auch alle 32.
- Am schnellsten geht es so: eine Taste anlegen und einstellen, dann mit Strg+C/Strg+V vervielfältigen.

Mehr Sessions als Slots: Die weniger dringenden sind dann nicht zu sehen. Blättern kommt in Phase 4.

## 3. Verbindung einstellen

Eine beliebige Slot-Taste anklicken. Im Property Inspector unten stehen oben die **globalen** Einstellungen. Sie gelten für alle Tasten und werden nur einmal eingetragen.

| Feld              | Wert                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Hub-URL           | `http://10.1.5.229:8788`. `/ws` am Ende und `ws://` gehen auch.                                                                           |
| Token             | der VPN-Token (`HUB_VPN_TOKEN`), nicht der öffentliche `HUB_TOKEN`                                                                        |
| Status            | live: `verbunden · n Sessions`, `verbinde …`, `getrennt – <Grund>`, `nicht eingerichtet`                                                  |
| Session öffnen in | **Browser** (Standard) oder **Claude-App**, siehe unten                                                                                   |
| Inaktiv nach      | 10, 15 oder 30 Minuten ohne Event → Taste zeigt `INAKTIV`. Der Hub selbst setzt nach 30 Min. `idle`, längere Werte gibt es deshalb nicht. |
| Ton bei Rot       | wird gespeichert, wirkt erst ab Phase 4                                                                                                   |

**Verbindung testen** fragt `GET /state` mit dem Token ab und zeigt `OK · n Sessions` oder den Fehler, z. B. `Token abgelehnt (401)`.
**Snippet kopieren** kopiert den Prompt aus [`setup-hub.md`, Abschnitt 7](setup-hub.md#7-weitere-repos-anbinden), mit dem du ein weiteres Repo anbindest.

Der Token liegt nur in den Stream-Deck-Einstellungen auf deinem PC. Er steht nicht im Repo, und das Plugin schreibt ihn nicht ins Log.

## 4. Einstellungen pro Taste

| Feld          | Bedeutung                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Belegung      | **Automatisch**: Session nach Dringlichkeit. **Fest**: immer dieselbe Session, das Repo wählst du aus (Punkt oben rechts auf der Taste).                    |
| Position      | nur bei Automatisch. „Nach Tastenposition“ (Standard) oder fest „n. dringendste Session“. Die übrigen Tasten füllen dann die freien Plätze.                 |
| Repo          | nur bei Fest. Die Liste zeigt die Repos der Sessions, die der Hub gerade kennt. Gibt es mehrere Sessions im Repo, zeigt die Taste die dringendste und `n×`. |
| Name anzeigen | eigener Name statt Repo-Name (`florianwilde/agent-deck` → `agent-deck`)                                                                                     |

Repos mit fester Taste tauchen nicht zusätzlich auf automatischen Tasten auf.

## 5. Bedienung

| Aktion                         | Wirkung                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| kurz drücken                   | öffnet die Session (`https://claude.ai/code/session_…`). Auf einer freien Taste oder ohne Hub öffnet sie `https://claude.ai/code`. |
| lang drücken (≥ 0,6 s)         | quittiert die Session (`POST /sessions/:id/ack`): Rot blinkt nicht mehr. Haken = ok, Warndreieck = fehlgeschlagen.                 |
| Taste blinkt rot               | Claude wartet auf dich (Frage oder Freigabe)                                                                                       |
| drei Punkte wandern            | Claude arbeitet                                                                                                                    |
| `OFFLINE · –` auf allen Tasten | keine Verbindung zum Hub. Das Plugin versucht es selbst wieder (nach 1 s, 2 s, 4 s … bis alle 30 s).                               |

### Browser oder Claude-App

Stream Deck öffnet Links immer im **Standardbrowser** von Windows. Einen anderen Browser kann das Plugin nicht wählen.

Die Claude-App für Windows hat das URL-Schema `claude://` ([Hilfe-Artikel](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link)). Dokumentiert sind dort aber nur neue Code-Sessions (`claude://code/new`), Chats und Projekte, **kein Link auf eine bestehende Cloud-Session**. Mit „Claude-App“ öffnet das Plugin deshalb versuchsweise `claude://claude.ai/code/session_…`. Wenn die App dabei nicht die Session zeigt, stell auf „Browser“ zurück.

## Fehlersuche

| Anzeige                               | Ursache und Abhilfe                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `nicht eingerichtet`                  | Hub-URL oder Token fehlt, oder die URL ist ungültig (sie muss mit `http://` beginnen)                                                     |
| `getrennt – Token abgelehnt (401)`    | falscher Token. Achtung: gemeint ist `HUB_VPN_TOKEN`, nicht `HUB_TOKEN`.                                                                  |
| `getrennt – ECONNREFUSED`/`ETIMEDOUT` | Hub läuft nicht oder ist über das VPN nicht erreichbar. `http://10.1.5.229:8788/health` im Browser prüfen und NetBird verbinden.          |
| Session fehlt                         | Das Repo hat den Hook noch nicht (`setup-hub.md`, Abschnitt 7), oder die Session ist eine Multi-Repo-Session (die lädt keine Repo-Hooks). |

Logs des Plugins: `%appdata%\Elgato\StreamDeck\Plugins\de.wildeflorian.agentdeck.sdPlugin\logs\`.

## Selbst bauen (Entwicklung)

```bash
pnpm install
pnpm --filter @agent-deck/streamdeck-plugin run package   # → packages/streamdeck-plugin/dist/*.streamDeckPlugin
```

Der Workflow `.github/workflows/plugin-release.yml` baut das Plugin bei jedem Pull Request als Artefakt. Ein Release entsteht, wenn ein Tag `plugin-v<version>` gepusht wird oder unter _Actions → plugin-release → Run workflow_ mit dem Tag als Eingabe. Vorher die Version in `manifest.json` und `package.json` anheben.
