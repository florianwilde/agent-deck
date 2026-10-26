# Phase 2 – Stream-Deck-Plugin MVP

Lies zuerst `CLAUDE.md`, `docs/progress.md` und **alle Dateien in `docs/design/`**. Sieh dir die vier Screenshots an, bevor du etwas baust.

## Ziel
Auf dem Stream Deck XL erscheinen die Cloud-Sessions als Tasten mit Live-Farbe. Ein Druck öffnet die Session.

## Aufgaben

1. Prüfe per Context7 bzw. WebFetch die aktuelle Doku: https://docs.elgato.com/sdk/ (Node-Version, Manifest, `setImage`, Property Inspector, `sdpi-components`, Long Press, Profile).
2. Scaffolde `packages/streamdeck-plugin` mit `streamdeck create` (Plugin-UUID `de.wildeflorian.agentdeck`, Name „agent-deck“). Mindestversion Stream Deck 7.1, Plattform Windows.
3. **Renderer** (`src/render/`): `keys.js` nach TypeScript portieren – `projectKey`, `overviewKey`, `commandKey`, `wrapName`, `nameFontSize`, Tokens. Geometrie, Farben und Texte unverändert.
   - Snapshot-Tests: Für jeden Zustand aus `screenshots/01-…png` muss das TS-SVG dem von `keys.js` entsprechen.
   - Vorschauseite `tools/preview.html`, die die TS-Renderer nutzt; per Playwright einen Screenshot erzeugen und mit `docs/design/screenshots/01-…png` und `03-…png` vergleichen. Abweichungen beheben, Screenshot in den PR legen.
4. **Hub-Verbindung** (`src/hub-client.ts`): WebSocket zur Hub-URL aus den globalen Einstellungen, Token als Header, Snapshot + Deltas, Reconnect mit Backoff (1 s → 30 s). Ohne Verbindung zeigen alle Slots `offline`.
5. **Aktion „Projekt-Slot“** (`de.wildeflorian.agentdeck.slot`):
   - Automatische Belegung: Alle Slot-Instanzen werden nach ihrer Position auf dem Gerät sortiert (Zeile, dann Spalte) und bekommen die Sessions nach Priorität (Status, dann `since`). Freie Slots zeigen die leere Taste.
   - Feste Belegung: im Property Inspector ein Repo wählen.
   - Kurz drücken: Session-URL öffnen (`streamDeck.system.openUrl`); ohne URL `https://claude.ai/code`. Einstellung „Browser / Claude-App“ laut Screenshot 04 – falls die Claude-App kein URL-Schema hat, nur Browser anbieten und das in `docs/progress.md` notieren.
   - Lang drücken (≥ 600 ms): `POST /sessions/:id/ack`.
   - Blinken bei `needs_input` (600 ms), Punkte-Animation bei `working` (500 ms), Zeitangabe jede Minute aktualisieren. Nur Tasten neu zeichnen, deren Bild sich ändert.
6. **Property Inspector** mit `sdpi-components` laut Screenshot 04: global (Hub-URL, Token, Status live, Öffnen in, Inaktiv-Timeout, Ton bei Rot – Ton erst in Phase 4, Feld schon anlegen, „Verbindung testen“) und pro Slot (Belegung, Position/Repo, Anzeigename).
7. Build und `streamdeck pack` laufen in der Cloud-Session; das gepackte `.streamDeckPlugin` als Release-Asset bzw. Artefakt bereitstellen.
8. `docs/setup-plugin.md`: Installation unter Windows, Verbindung über VPN, wie viele Slot-Tasten man auf dem XL platziert.

## Fertig, wenn
- Renderer-Snapshots grün, Preview-Screenshot entspricht dem Design.
- Unter Windows (von mir getestet): Slots zeigen echte Sessions, Rot bei Frage, Gelb bei fertig, Druck öffnet die Session, Langdruck quittiert.
- `docs/progress.md` aktualisiert, PR offen, Phase angehalten.
