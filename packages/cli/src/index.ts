#!/usr/bin/env node
/**
 * agent-deck CLI: `agent-deck init [pfad]` und `agent-deck init --uninstall [pfad]`.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { CliError, runInit } from "./init.ts";

export const USAGE = `Verwendung:
  agent-deck init [pfad]              Hook nach <pfad>/.claude/hooks/ kopieren und in
                                      <pfad>/.claude/settings.json eintragen
  agent-deck init --uninstall [pfad]  nur die agent-deck-Einträge und -Dateien entfernen

Optionen:
  -u, --uninstall  entfernen statt eintragen
  -h, --help       diese Hilfe

Standard für [pfad] ist das aktuelle Verzeichnis. Fremde Hooks und Einstellungen
bleiben erhalten; vor jeder Änderung wird .claude/settings.json.bak angelegt.`;

export interface MainIo {
  out: (line: string) => void;
  err: (line: string) => void;
  cwd: string;
}

/** Basis für relative Pfade. Bei `pnpm agent-deck …` ist cwd die Repo-Wurzel, INIT_CWD der Aufrufort. */
function defaultCwd(): string {
  const env = process.env;
  return env.npm_lifecycle_event === "agent-deck" && env.INIT_CWD ? env.INIT_CWD : process.cwd();
}

/** Führt das CLI aus und liefert den Exit-Code (0 ok, 1 Fehler, 2 falscher Aufruf). */
export function main(argv: string[], io: Partial<MainIo> = {}): number {
  const out = io.out ?? ((line: string) => console.log(line));
  const err = io.err ?? ((line: string) => console.error(line));
  const cwd = io.cwd ?? defaultCwd();

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        uninstall: { type: "boolean", short: "u" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    err(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    err(USAGE);
    return 2;
  }

  const { values, positionals } = parsed;
  if (values.help) {
    out(USAGE);
    return 0;
  }
  const [command, target, ...rest] = positionals;
  if (command !== "init" || rest.length > 0) {
    err(
      command === undefined
        ? "Fehler: Befehl fehlt."
        : `Fehler: unbekannter Aufruf: ${positionals.join(" ")}`,
    );
    err(USAGE);
    return 2;
  }

  try {
    runInit({
      target: path.resolve(cwd, target ?? "."),
      uninstall: values.uninstall === true,
      log: out,
    });
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      err(`Fehler: ${e.message}`);
      return e.exitCode;
    }
    err(`Unerwarteter Fehler: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
