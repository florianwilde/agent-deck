# agent-deck – Design-Vorgaben

Diese Dateien gehören nach `docs/design/` im Repo. Sie sind verbindliche Vorlage für das Stream-Deck-Plugin.

| Datei | Inhalt |
| --- | --- |
| `keys.js` | Referenz-Renderer: erzeugt jedes Tastenbild als SVG-String. Ins Plugin portieren (TypeScript), Werte und Geometrie beibehalten. |
| `mockups.html` | Mockup-Seite, rendert alle Zustände mit `keys.js`. Im Browser öffnen zum Vergleichen. |
| `screenshots/01-projekt-slot-zustaende.png` | Alle Zustände der Projekt-Slot-Taste |
| `screenshots/02-weitere-aktionen.png` | Ampel, Prompt-Makro, Queue, Blättern |
| `screenshots/03-beispiel-belegung-15-tasten.png` | Gesamtbild auf einem Stream Deck MK.2 |
| `screenshots/04-property-inspector.png` | Globale Einstellungen + Tasteneinstellungen |

## Grundregeln

- Tastenbild 144 × 144 px (@2x), als SVG per `setImage("data:image/svg+xml;charset=utf8," + encodeURIComponent(svg))`.
- Schrift: `'Segoe UI', Inter, Arial, sans-serif` (Windows hat Segoe UI immer).
- **Laute Zustände** (Antwort, Fertig, Fehler) füllen die ganze Taste. **Ruhige Zustände** (Arbeitet, Inaktiv, Offline) haben dunkle Fläche und nur eine Statusleiste unten. So fällt auf, was Aufmerksamkeit braucht.
- Text nie kleiner als 11 px (bei 144 px Kantenlänge).

## Farben

| Token | Hex | Verwendung |
| --- | --- | --- |
| `bg` | `#14171C` | Grund jeder Taste |
| `bgRaised` | `#1E232B` | Innenfläche ruhiger Tasten |
| `text` | `#F2F4F7` | Haupttext |
| `textDim` | `#8A93A1` | Nebentext, Symbole |
| Antwort | `#E5484D` (Blinkphase `#8E2B2F`) | Claude braucht dich |
| Fertig | `#F5B83D`, Text `#1A1300` | wartet auf nächsten Prompt |
| Fehler | `#F76B15` | StopFailure |
| Arbeitet | `#30A46C` | läuft |
| Inaktiv | `#5B6470` | kein Event seit 30 Min. |
| Offline | `#3A404A` | keine Verbindung zum Hub |
| Makro-Akzent | `#8E8CF5` | Prompt-Makro-Symbol |

## Projekt-Slot – Aufbau

- Oben links: Wolken-Symbol (Cloud-Session). Oben rechts: Queue-Zähler `+n` (gelbe Pille), daneben ggf. Sitzungszähler `2×`.
- Mitte: Repo-Name, 1–2 Zeilen, bis 15 Zeichen pro Zeile; Schrift 20 px, schrumpft bis 15 px (`nameFontSize`). Umbruch an `- _ .`, sonst Kürzung mit `…`.
- Unten: Statuslabel in Versalien + Zeit seit Statuswechsel (`ANTWORT · 4m`, `ARBEITET · 2m`, Einheiten m/h/d).
- Arbeitet: drei Punkte, der helle wandert alle 500 ms (Animation durch erneutes `setImage`).
- Antwort blinkt: alle 600 ms zwischen `blinkPhase` 0 und 1. Nach Quittieren (Langdruck) kein Blinken mehr.

## Weitere Tasten

- **Ampel**: Fläche in der dringendsten Farbe, große Zahl = rot + gelb, Unterzeile „1 rot · 2 gelb“. Alles ruhig = dunkle Fläche, „0“ in `textDim`.
- **Prompt-Makro**: Blitz-Symbol in Makro-Akzent, Titel, Unterzeile = Ziel („→ zuletzt aktiv“ oder Repo-Name). Ziel nicht gefunden = orangenes Warndreieck.
- **Queue**: drei Balken, Zähler oben rechts (gelb, wenn > 0), Unterzeile = Anfang des nächsten Eintrags.
- **Blättern**: Pfeil, „Seite x/y“, Unterzeile = Gesamtzahl Sessions.

## Property Inspector

Mit `sdpi-components` umsetzen, Aufbau wie `04-property-inspector.png`:
- Global: Hub-URL, Token (Passwortfeld), Verbindungsstatus live, „Session öffnen in“ (Browser / Claude-App), Inaktiv-Timeout, Ton bei Rot (Aus / Einmal / Immer), Buttons „Verbindung testen“ und „Snippet kopieren“ (kopiert die Hook-Konfiguration für ein Repo).
- Projekt-Slot: Belegung (Automatisch / Fest), Position bzw. Repo, Anzeigename.
- Prompt-Makro: Titel, Prompt-Text, Ziel-Session.

## Mitgelieferte Profile

Für Stream Deck MK.2 (15): Belegung wie `03-…png`. Für Mini (6), XL (32), + und Neo sinngemäß: Ampel immer oben links, Makros/Queue/Blättern in der untersten Reihe, Rest Slots.
