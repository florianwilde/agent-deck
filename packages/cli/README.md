# @agent-deck/cli

Bindet ein Ziel-Repo an agent-deck an: kopiert den Hook nach `.claude/hooks/agent-deck.sh` und trägt ihn in `.claude/settings.json` ein. `--uninstall` entfernt nur die eigenen Einträge.

## Aufruf

```bash
# im agent-deck-Monorepo, ohne Build (Node ≥ 24, Type-Stripping)
pnpm agent-deck init /pfad/zum/ziel-repo
pnpm agent-deck init --uninstall /pfad/zum/ziel-repo

# nach dem Build
pnpm --filter @agent-deck/cli build
node packages/cli/dist/index.js init /pfad/zum/ziel-repo
```

Ohne Pfad wird das aktuelle Verzeichnis genommen (bei `pnpm agent-deck` das Verzeichnis, aus dem `pnpm` aufgerufen wurde). `--help` zeigt die Hilfe.

Exit-Codes: `0` ok, `1` Fehler (Ziel fehlt, Hook-Skript fehlt, `settings.json` ungültig), `2` falscher Aufruf.

## Was `init` macht

- Prüft, dass der Pfad existiert. Fehlt `.git`, gibt es nur eine Warnung.
- Kopiert `packages/hook/agent-deck.sh` nach `<pfad>/.claude/hooks/agent-deck.sh` (Modus `0755`). Die Quelle wird relativ zum CLI-Paket gefunden (`../../hook/` von `src/` bzw. `dist/` aus), das CLI läuft also nur aus dem Monorepo heraus. Ein Kopieren nach `dist/` gibt es bewusst nicht; die interne API (`runInit({ hookSource })`) kann die Quelle überschreiben.
- Trägt für jedes Event aus `HOOK_EVENTS` (`@agent-deck/shared`) eine eigene Gruppe ohne `matcher` ein:

  ```json
  {
    "type": "command",
    "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/agent-deck.sh",
    "args": [],
    "async": true
  }
  ```

  `Stop` (`SYNC_HOOK_EVENTS`) läuft synchron, ohne `async`, mit `"timeout": 5`.

- `"args": []` wählt die Exec-Form: Claude Code startet das Skript direkt, ohne Shell. Die [Hooks-Doku](https://code.claude.com/docs/en/hooks) empfiehlt das für Befehle mit Pfad-Platzhaltern, weil Leerzeichen im Projektpfad dann kein Quoting brauchen. Nötig ist das Feld nicht.
- **Merge:** andere Top-Level-Keys, fremde Hooks, Gruppen und Matcher bleiben unverändert, die Reihenfolge der Keys auch. Zweimal `init` ergibt dieselbe Datei. Eigene Einträge mit falscher Form werden korrigiert, nicht verdoppelt. Ein eigener Handler in einer fremden Gruppe (z. B. mit Matcher) wird dort entfernt und in eine eigene Gruppe verschoben.
- **Eigene Einträge** sind Handler, deren `command` auf `/.claude/hooks/agent-deck.sh` endet. Dazu kommen die Altlasten aus Phase 0 (`agent-deck-capture.sh`, `queue-test.sh`): Diese Handler und Dateien werden entfernt. Gruppen und Events, die dadurch leer werden, fallen weg.
- **Backup:** Ändert sich eine vorhandene `settings.json`, wird vorher `settings.json.bak` geschrieben (ein altes Backup wird überschrieben).
- Ausgabe als JSON mit 2 Leerzeichen Einrückung und Newline. Eine fehlende oder leere Datei wird mit `"$schema": "https://json.schemastore.org/claude-code-settings.json"` neu angelegt. Bei ungültigem JSON bricht das CLI ab und ändert nichts.

## `--uninstall`

Entfernt nur die eigenen Handler (inklusive Altlasten), leere Gruppen und Events und `hooks`, wenn es danach leer ist. Löscht `.claude/hooks/agent-deck.sh` und Altlasten-Dateien, das Verzeichnis `.claude/hooks/` nur, wenn es danach leer ist. Fremdes bleibt. Backup wie oben.

## Danach

Im Ziel-Repo `.claude/settings.json` und `.claude/hooks/agent-deck.sh` committen. In der Cloud-Umgebung `AGENT_DECK_URL` setzen, ein Network Secret für die Hub-Domain anlegen und Network access auf **Custom** stellen (siehe `docs/setup-hub.md`).

## Aufbau

- `src/settings.ts`: reine Funktionen `installHooks` und `uninstallHooks`, ohne I/O.
- `src/init.ts`: Datei-I/O (`runInit`), testbar mit Zielpfad und Hook-Quelle als Parameter.
- `src/index.ts`: Argumente (`node:util` `parseArgs`), `bin` `agent-deck` → `dist/index.js`.
