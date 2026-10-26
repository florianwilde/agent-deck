# Phase 4 – Komfort, Profil fürs XL, Feinschliff

Lies zuerst `CLAUDE.md`, `docs/progress.md` und `docs/design/`.

## Ziel
Auch mit 20+ Sessions bleibt das Stream Deck XL übersichtlich und fühlt sich fertig an.

## Aufgaben

1. **Aktion „Ampel“** (`…agentdeck.overview`): Anzahl `needs_input` + `done`, Farbe der dringendsten Session, Unterzeile „x rot · y gelb“ (Design `02-…png`). Kurz: dringendste Session öffnen. Lang: alle `done`-Sessions quittieren.
2. **Aktion „Blättern“** (`…agentdeck.page`): Gibt es mehr Sessions als Slots, verteilen sich die Sessions auf Seiten. Kurz: nächste Seite, lang: Seite 1. Anzeige „Seite x/y“ + Gesamtzahl. Rote Sessions immer auf Seite 1 (vor allen anderen), egal welche Seite gerade aktiv ist.
3. **Quittieren** verfeinern: quittierte rote Taste blinkt nicht mehr, bleibt aber rot; neues Event hebt das Quittieren auf.
4. **Ton bei Rot** (Aus / Einmal / Immer, Einstellung aus Phase 2): kurzer Hinweiston über die Windows-Systemklänge oder eine mitgelieferte WAV, nur beim Wechsel nach `needs_input`. Falls das SDK keine Tonausgabe erlaubt, sauber begründen und weglassen.
5. **Profil Stream Deck XL** ins Plugin-Paket aufnehmen, Belegung exakt wie `docs/design/screenshots/03-beispiel-belegung-xl-32-tasten.png`: Ampel oben links, 23 Projekt-Slots (automatisch), unterste Reihe sechs Makros („Tests“, „Weiter“, „Review“, „Doku“, „Commit+PR“, „Aufräumen“ mit sinnvollen Standard-Prompts), Queue, Blättern. Beim ersten Start anbieten (`switchToProfile` laut SDK).
6. **Lesbarkeit auf dem XL**: Die XL-Tasten sind 96 px. Preview-Screenshot in 96 px erzeugen und prüfen, ob Statuslabel und Unterzeilen lesbar sind; ggf. Schriftgrößen in `DESIGN.md` und Renderer gemeinsam anheben (nicht nur im Code).
7. **Robustheit**: Hub-Neustart, VPN-Abbruch, Stream-Deck-Neustart, Session ohne URL, Repo-Name sehr lang, 40 Sessions gleichzeitig – jeweils testen oder simulieren, Verhalten in `docs/progress.md` festhalten.
8. **README** im Repo-Root: Was ist agent-deck, Screenshot `03-…png`, Schnellstart (Hub, Cloud-Umgebung, `agent-deck init`, Plugin installieren), Sicherheitshinweise.
9. Release: Version 1.0.0 setzen, Changelog, gepacktes `.streamDeckPlugin` als Release-Asset.

## Fertig, wenn
- Mit 25+ simulierten Sessions bleibt die Anzeige korrekt, rote Sessions stehen immer vorn.
- XL-Profil installiert sich und entspricht dem Screenshot.
- README vollständig, Release 1.0.0 erstellt, `docs/progress.md` aktualisiert, PR offen.
