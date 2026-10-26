# @agent-deck/shared

Gemeinsame Typen und Konstanten für Hub, Hook, CLI und Plugin (`src/index.ts`):

| Export                                             | Inhalt                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `StatusSchema`, `STATUS_PRIORITY`, `STATUS_COLORS` | Status-Enum laut `CLAUDE.md`, Priorität und Farben                                           |
| `HookEventSchema`                                  | Was der Hook an `POST /events` sendet (unbekannte Felder werden verworfen)                   |
| `SessionSchema`, `sessionUrl()`                    | Session-Stand, wie ihn `GET /state` und `WS /ws` liefern                                     |
| `WsMessageSchema`                                  | WebSocket-Nachrichten `snapshot`, `session.upsert`, `session.remove`                         |
| `HOOK_EVENTS`, `SYNC_HOOK_EVENTS`                  | Events, die `agent-deck init` registriert (`docs/event-mapping.md`)                          |
| `*_TIMEOUT_MS`, `*_REMOVE_MS`                      | Timeouts: working 10 Min., alles 30 Min., Entfernen 10 Min. nach `SessionEnd` bzw. 24 h idle |

Tests und Typecheck lesen das Paket direkt aus `src/` (Export-Bedingung `source`), der Build (`pnpm --filter @agent-deck/shared build`) erzeugt `dist/` für den Hub im Betrieb.
