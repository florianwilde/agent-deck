/**
 * Reine Funktionen zum Ein- und Austragen der agent-deck-Hooks in einer
 * `.claude/settings.json`. Kein I/O, die Eingabe wird nie verändert.
 */
import { HOOK_EVENTS, SYNC_HOOK_EVENTS, SYNC_HOOK_TIMEOUT_S } from "@agent-deck/shared";

export type JsonObject = Record<string, unknown>;

export const SETTINGS_SCHEMA_URL = "https://json.schemastore.org/claude-code-settings.json";

/** Dateiname des Hooks unter `.claude/hooks/`. */
export const HOOK_FILE = "agent-deck.sh";
/** Altlasten aus Phase 0, werden bei `init` und `--uninstall` entfernt. */
export const LEGACY_HOOK_FILES = ["agent-deck-capture.sh", "queue-test.sh"] as const;

export const HOOK_COMMAND = `\${CLAUDE_PROJECT_DIR}/.claude/hooks/${HOOK_FILE}`;

const OWN_SUFFIX = `/.claude/hooks/${HOOK_FILE}`;
const LEGACY_SUFFIXES = LEGACY_HOOK_FILES.map((f) => `/.claude/hooks/${f}`);

export class SettingsError extends Error {}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commandOf(handler: unknown): string | undefined {
  if (!isObject(handler) || typeof handler.command !== "string") return undefined;
  // Ein abschließendes Anführungszeichen (Shell-Form mit Quoting) ignorieren.
  return handler.command.trim().replace(/["']$/, "");
}

/** Handler, der auf `/.claude/hooks/agent-deck.sh` zeigt. */
export function isOwnHandler(handler: unknown): boolean {
  return commandOf(handler)?.endsWith(OWN_SUFFIX) ?? false;
}

/** Handler aus Phase 0 (`agent-deck-capture.sh`, `queue-test.sh`). */
export function isLegacyHandler(handler: unknown): boolean {
  const command = commandOf(handler);
  return command !== undefined && LEGACY_SUFFIXES.some((s) => command.endsWith(s));
}

function isManagedHandler(handler: unknown): boolean {
  return isOwnHandler(handler) || isLegacyHandler(handler);
}

/**
 * Soll-Form unseres Handlers für ein Event. Exec-Form (`args: []`), weil die
 * Hooks-Doku sie für Pfad-Platzhalter empfiehlt: kein Shell-Parsing, Leerzeichen
 * im Projektpfad sind unkritisch.
 */
export function desiredHandler(event: string): JsonObject {
  const base = { type: "command", command: HOOK_COMMAND, args: [] as string[] };
  return (SYNC_HOOK_EVENTS as readonly string[]).includes(event)
    ? { ...base, timeout: SYNC_HOOK_TIMEOUT_S }
    : { ...base, async: true };
}

function checkSettings(settings: unknown): JsonObject {
  if (!isObject(settings)) {
    throw new SettingsError("settings.json muss ein JSON-Objekt enthalten.");
  }
  const hooks = settings.hooks;
  if (hooks !== undefined && !isObject(hooks)) {
    throw new SettingsError('"hooks" in settings.json muss ein Objekt sein.');
  }
  return settings;
}

/** Gruppe nur aus `hooks`, ohne Matcher oder andere Felder. */
function isPlainGroup(group: JsonObject): boolean {
  return Object.keys(group).every((k) => k === "hooks");
}

/**
 * Entfernt verwaltete Handler aus den Gruppen eines Events. Liefert die
 * bereinigten Gruppen (leere entfernt) und den Index einer Gruppe, die nur aus
 * unserem Handler bestand (für Wiederverwendung an derselben Stelle).
 */
function stripGroups(groups: unknown[]): { groups: unknown[]; ownSlot: number } {
  const result: unknown[] = [];
  let ownSlot = -1;
  for (const group of groups) {
    if (!isObject(group) || !Array.isArray(group.hooks)) {
      result.push(group);
      continue;
    }
    const handlers = group.hooks as unknown[];
    if (!handlers.some(isManagedHandler)) {
      result.push(group);
      continue;
    }
    const remaining = handlers.filter((h) => !isManagedHandler(h));
    if (remaining.length > 0) {
      result.push({ ...group, hooks: remaining });
    } else if (ownSlot === -1 && isPlainGroup(group) && handlers.some(isOwnHandler)) {
      ownSlot = result.length;
      result.push({ hooks: [] });
    }
    // sonst: Gruppe ist leer geworden → entfällt
  }
  return { groups: result, ownSlot };
}

function transform(input: unknown, install: boolean): JsonObject {
  const settings = structuredClone(checkSettings(input));
  const oldHooks = (settings.hooks as JsonObject | undefined) ?? {};
  const wanted = new Set<string>(install ? HOOK_EVENTS : []);
  const newHooks: JsonObject = {};

  const place = (event: string, groups: unknown[], ownSlot: number): void => {
    if (wanted.has(event)) {
      const own = { hooks: [desiredHandler(event)] };
      if (ownSlot >= 0) groups[ownSlot] = own;
      else groups.push(own);
      wanted.delete(event);
    } else if (ownSlot >= 0) {
      groups.splice(ownSlot, 1);
    }
    if (groups.length > 0) newHooks[event] = groups;
  };

  for (const [event, value] of Object.entries(oldHooks)) {
    if (!Array.isArray(value)) {
      if (wanted.has(event)) {
        throw new SettingsError(`"hooks.${event}" in settings.json muss ein Array sein.`);
      }
      newHooks[event] = value;
      continue;
    }
    const { groups, ownSlot } = stripGroups(value);
    place(event, groups, ownSlot);
  }
  for (const event of HOOK_EVENTS) {
    if (wanted.has(event)) place(event, [], -1);
  }

  if (Object.keys(newHooks).length > 0) {
    settings.hooks = newHooks;
  } else {
    delete settings.hooks;
  }
  return settings;
}

/** Trägt unsere Hooks ein (idempotent), entfernt Altlasten. Fremdes bleibt. */
export function installHooks(settings: unknown): JsonObject {
  return transform(settings, true);
}

/** Entfernt unsere Hooks und Altlasten, leere Gruppen/Events und ggf. `hooks`. */
export function uninstallHooks(settings: unknown): JsonObject {
  return transform(settings, false);
}

/** Inhalt einer neu angelegten settings.json (vor `installHooks`). */
export function emptySettings(): JsonObject {
  return { $schema: SETTINGS_SCHEMA_URL };
}

/** 2-Space-JSON mit abschließendem Newline. */
export function serializeSettings(settings: JsonObject): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}
