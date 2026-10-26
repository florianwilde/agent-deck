# @agent-deck/streamdeck-plugin

Stream-Deck-Plugin (`@elgato/streamdeck` v3, Stream Deck ≥ 7.1, Windows) für das Stream Deck XL. Die Aktion **Projekt-Slot** (`de.wildeflorian.agentdeck.slot`) zeigt eine Cloud-Session mit Live-Status. Ein Druck öffnet die Session, ein langer Druck quittiert sie.

Installation und Bedienung: [`docs/setup-plugin.md`](../../docs/setup-plugin.md).

## Aufbau

| Pfad                                   | Inhalt                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/render/`                          | TypeScript-Port von `docs/design/keys.js`, byte-gleiche SVGs; dazu `emptyKey`, `formatSince`, `svgToDataUrl`       |
| `src/hub-client.ts`                    | WebSocket zum VPN-Listener (Token im Handshake), Snapshot + Deltas, Backoff 1 s → 30 s, `ack`, „Verbindung testen“ |
| `src/slots.ts`                         | reine Belegungslogik: Priorität, `since`, Tastenposition, feste Repos, lokaler Inaktiv-Timeout                     |
| `src/deck.ts`                          | hält die Tasten, Takt 100 ms (Blinken 600 ms, Punkte 500 ms, Zeit minütlich), sendet nur geänderte Bilder          |
| `src/actions/slot.ts`, `src/plugin.ts` | dünne Adapter zum SDK                                                                                              |
| `src/settings.ts`                      | globale und Tasten-Einstellungen, Nachrichten Property Inspector ↔ Plugin                                          |
| `de.wildeflorian.agentdeck.sdPlugin/`  | Manifest, Bilder, Property Inspector (`ui/slot.html`, sdpi-components v4.0.1 lokal unter `ui/vendor/`)             |
| `tools/`                               | Vorschau, Screenshots, Icon-Erzeugung, Smoke-Test                                                                  |

## Befehle

```bash
pnpm --filter @agent-deck/streamdeck-plugin build      # esbuild → *.sdPlugin/bin/plugin.js
pnpm --filter @agent-deck/streamdeck-plugin run package # build + streamdeck pack → dist/
pnpm --filter @agent-deck/streamdeck-plugin validate   # Manifest prüfen
pnpm exec vitest run packages/streamdeck-plugin        # Tests (Renderer, Belegung, Deck, Hub-Client gegen echten Hub)
```

Werkzeuge (aus `packages/streamdeck-plugin`, Playwright ist global installiert, daher `NODE_PATH=$(npm root -g)`):

```bash
node --conditions=source --experimental-strip-types tools/preview.ts   # tools/preview.html aus den TS-Renderern
NODE_PATH=$(npm root -g) node tools/screenshot.mjs                     # → tools/preview.png
NODE_PATH=$(npm root -g) node tools/pi-check.mjs                       # Property Inspector gegen Fake-Stream-Deck, → tools/pi-preview.png
node tools/smoke.mjs                                                    # gebautes Plugin + echter Hub + Fake-Stream-Deck
node --conditions=source --experimental-strip-types tools/icons.ts && NODE_PATH=$(npm root -g) node tools/rasterize.mjs  # Manifest-Bilder
```
