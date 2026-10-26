/**
 * Datei-I/O für `agent-deck init` und `agent-deck init --uninstall`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOOK_FILE,
  LEGACY_HOOK_FILES,
  SettingsError,
  emptySettings,
  installHooks,
  serializeSettings,
  uninstallHooks,
  type JsonObject,
} from "./settings.ts";

/** Fehler, den das CLI als Meldung plus Exit-Code ausgibt. */
export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

export interface InitOptions {
  /** Ziel-Repo (Wurzel, in der `.claude/` liegt). */
  target: string;
  /** Entfernen statt eintragen. */
  uninstall?: boolean;
  /** Quelle von `agent-deck.sh`; Standard: `packages/hook/agent-deck.sh` im Monorepo. */
  hookSource?: string;
  /** Ausgabe einer Zeile (Standard: stdout). */
  log?: (line: string) => void;
}

export interface InitResult {
  settingsPath: string;
  settingsChanged: boolean;
  backupPath?: string;
  messages: string[];
}

/**
 * Standard-Quelle des Hooks. `src/init.ts` und `dist/init.js` liegen gleich
 * tief, daher zeigt `../../hook/` in beiden Fällen auf `packages/hook/`.
 */
export function defaultHookSource(): string {
  return fileURLToPath(new URL(`../../hook/${HOOK_FILE}`, import.meta.url));
}

function readSettings(file: string): { exists: boolean; raw: string; settings: JsonObject } {
  if (!fs.existsSync(file)) return { exists: false, raw: "", settings: emptySettings() };
  const raw = fs.readFileSync(file, "utf8");
  if (raw.trim() === "") return { exists: true, raw, settings: emptySettings() };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CliError(
      `${file} enthält kein gültiges JSON (${detail}). Datei bleibt unverändert, bitte von Hand korrigieren.`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliError(`${file} muss ein JSON-Objekt enthalten. Datei bleibt unverändert.`);
  }
  return { exists: true, raw, settings: parsed as JsonObject };
}

function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function removeFile(file: string, label: string, messages: string[]): void {
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    messages.push(`Gelöscht: ${label}`);
  }
}

export function runInit(options: InitOptions): InitResult {
  const target = path.resolve(options.target);
  const log = options.log ?? ((line: string) => console.log(line));
  const messages: string[] = [];

  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new CliError(`Zielpfad existiert nicht oder ist kein Verzeichnis: ${target}`);
  }
  if (!fs.existsSync(path.join(target, ".git"))) {
    messages.push(`Warnung: ${target} ist kein Git-Repo (kein .git gefunden).`);
  }

  const claudeDir = path.join(target, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const settingsPath = path.join(claudeDir, "settings.json");
  const hookDest = path.join(hooksDir, HOOK_FILE);

  // Erst alles prüfen, dann schreiben: bei kaputtem JSON bleibt alles unangetastet.
  const current = readSettings(settingsPath);
  let next: JsonObject;
  try {
    next = options.uninstall ? uninstallHooks(current.settings) : installHooks(current.settings);
  } catch (err) {
    if (err instanceof SettingsError) throw new CliError(`${settingsPath}: ${err.message}`);
    throw err;
  }

  const hookSource = options.hookSource ?? defaultHookSource();
  if (!options.uninstall && !fs.existsSync(hookSource)) {
    throw new CliError(`Hook-Skript nicht gefunden: ${hookSource}`);
  }

  // settings.json
  const content = serializeSettings(next);
  const settingsChanged = content !== current.raw;
  let backupPath: string | undefined;
  const skipWrite = options.uninstall && !current.exists;
  if (settingsChanged && !skipWrite) {
    fs.mkdirSync(claudeDir, { recursive: true });
    if (current.exists && current.raw.trim() !== "") {
      backupPath = `${settingsPath}.bak`;
      fs.writeFileSync(backupPath, current.raw);
      messages.push(`Backup: .claude/settings.json.bak`);
    }
    writeAtomic(settingsPath, content);
    messages.push(
      options.uninstall
        ? "Hooks aus .claude/settings.json entfernt."
        : current.exists
          ? "Hooks in .claude/settings.json eingetragen."
          : ".claude/settings.json angelegt und Hooks eingetragen.",
    );
  } else {
    messages.push(".claude/settings.json ist bereits aktuell.");
  }

  // Hook-Dateien
  for (const legacy of LEGACY_HOOK_FILES) {
    removeFile(
      path.join(hooksDir, legacy),
      `.claude/hooks/${legacy} (Altlast aus Phase 0)`,
      messages,
    );
  }
  if (options.uninstall) {
    removeFile(hookDest, `.claude/hooks/${HOOK_FILE}`, messages);
    if (fs.existsSync(hooksDir) && fs.readdirSync(hooksDir).length === 0) fs.rmdirSync(hooksDir);
  } else {
    const source = fs.readFileSync(hookSource);
    const same =
      fs.existsSync(hookDest) &&
      fs.readFileSync(hookDest).equals(source) &&
      (fs.statSync(hookDest).mode & 0o777) === 0o755;
    if (same) {
      messages.push(`.claude/hooks/${HOOK_FILE} ist bereits aktuell.`);
    } else {
      fs.mkdirSync(hooksDir, { recursive: true });
      fs.writeFileSync(hookDest, source);
      fs.chmodSync(hookDest, 0o755);
      messages.push(`Kopiert: .claude/hooks/${HOOK_FILE} (0755)`);
    }
  }

  if (!options.uninstall) {
    messages.push(
      "",
      "Nächste Schritte (siehe docs/setup-hub.md):",
      "  - Cloud-Umgebung: AGENT_DECK_URL=https://<hub-domain> setzen.",
      "  - Network Secret für die Hub-Domain anlegen (Bearer-Token, steht nie im Repo).",
      "  - Network access auf Custom stellen und die Hub-Domain freigeben.",
      "  - .claude/settings.json und .claude/hooks/ committen.",
    );
  }

  for (const line of messages) log(line);
  return {
    settingsPath,
    settingsChanged: settingsChanged && !skipWrite,
    ...(backupPath ? { backupPath } : {}),
    messages,
  };
}
