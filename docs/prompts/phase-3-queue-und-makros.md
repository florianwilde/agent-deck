# Phase 3 – Prompt-Queue und Makros

Lies zuerst `CLAUDE.md`, `docs/progress.md` und `docs/cloud-findings.md` (Abschnitt Queue-Test aus Phase 0).

## Ziel
Vom Stream Deck aus lassen sich Prompts für eine Session einreihen. Sobald Claude mit dem aktuellen Turn fertig ist, macht es mit dem nächsten Eintrag weiter – ohne dass ich etwas tippe.

## Aufgaben

1. **Hub – Queue**:
   - Tabelle `queue` (session_id, position, text, created_at). Max. 20 Einträge pro Session, Text ≤ 2000 Zeichen.
   - VPN-Endpunkte: `GET /sessions/:id/queue`, `POST /sessions/:id/queue` (anhängen), `POST /sessions/:id/queue/rotate`, `DELETE /sessions/:id/queue` (leeren), `DELETE /sessions/:id/queue/:pos`.
   - Öffentlicher Endpunkt `POST /queue/next` (Body: `session_id`): gibt den ersten Eintrag zurück und entfernt ihn, sonst `204`. Atomar, damit ein Eintrag nie doppelt ausgeliefert wird.
   - `queueCount` in der Session pflegen und per WebSocket pushen.
2. **Hook – Stop**: `agent-deck.sh` ruft beim `Stop`-Event zuerst `POST /queue/next` auf (`--max-time 2`). Gibt es einen Eintrag, `{"decision":"block","reason":"<text>"}` auf stdout ausgeben und den Status auf `working` melden; sonst normal `done` melden. Verhalten bei `stop_hook_active=true` laut Doku prüfen und so lösen, dass mehrere Einträge nacheinander abgearbeitet werden, aber keine Endlosschleife entsteht. `agent-deck init` setzt den Stop-Hook **ohne** `async`.
3. **Hub – Makros**: Tabelle `macros` (id, title, text). VPN-Endpunkte `GET /macros`, `PUT /macros/:id`. Makros werden im Property Inspector gepflegt und im Hub gespeichert, damit sie geräteübergreifend gleich sind.
4. **Ziel-Session**: Hub merkt sich pro Session `lastPromptAt` (aus `UserPromptSubmit`). „Zuletzt aktiv“ = höchstes `lastPromptAt` unter Sessions, die nicht `idle` sind.
5. **Plugin – Aktion „Prompt-Makro“** (`…agentdeck.macro`): Aussehen laut Design. Kurz drücken: Text in die Queue der Ziel-Session. Lang drücken: Ziel wechseln (nächste aktive Session, Anzeige in der Unterzeile). Ist die Ziel-Session `done`, kurz „erst nach deinem nächsten Prompt“ anzeigen (Queue greift erst am nächsten `Stop`). Ziel nicht gefunden → Warnzustand. Kurzes `showOk` nach erfolgreichem Einreihen.
6. **Plugin – Aktion „Queue“** (`…agentdeck.queue`): zeigt Anzahl und Anfang des nächsten Eintrags der Ziel-Session. Kurz: rotieren. Lang: leeren (mit zweitem Langdruck innerhalb 3 s bestätigen).
7. Projekt-Slot zeigt den Queue-Zähler `+n` laut Design.
8. Tests: Queue-Endpunkte inkl. Nebenläufigkeit von `/queue/next`, Stop-Hook-Ausgabe, Zielauswahl.

## Fertig, wenn
- In einer laufenden Cloud-Session zwei Makros drücken: Nach dem aktuellen Turn arbeitet Claude den ersten, danach den zweiten Eintrag ab, Zähler läuft runter.
- Über den öffentlichen Endpunkt lässt sich nichts einreihen.
- `docs/progress.md` aktualisiert, PR offen, Phase angehalten.
