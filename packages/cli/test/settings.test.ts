import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOOK_EVENTS, SYNC_HOOK_EVENTS, SYNC_HOOK_TIMEOUT_S } from "@agent-deck/shared";
import {
  HOOK_COMMAND,
  SETTINGS_SCHEMA_URL,
  emptySettings,
  installHooks,
  uninstallHooks,
  type JsonObject,
} from "../src/settings.ts";

const fixture = (): JsonObject =>
  JSON.parse(
    readFileSync(new URL("./fixtures/phase-0-settings.json", import.meta.url), "utf8"),
  ) as JsonObject;

type Group = { matcher?: string; hooks: JsonObject[] };
const hooksOf = (s: JsonObject) => s.hooks as Record<string, Group[]>;

const foreign = { type: "command", command: "npm run lint", timeout: 30 };
const foreignSettings = (): JsonObject => ({
  model: "opus",
  hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [foreign] }],
    Stop: [{ hooks: [{ type: "command", command: "./notify.sh" }] }],
    WorktreeCreate: [{ hooks: [{ type: "command", command: "./wt.sh" }] }],
  },
  permissions: { allow: ["Bash(ls:*)"] },
});

describe("installHooks", () => {
  it("trägt jedes Event aus HOOK_EVENTS in eigener Gruppe ohne Matcher ein", () => {
    const result = installHooks(emptySettings());
    expect(result.$schema).toBe(SETTINGS_SCHEMA_URL);
    const hooks = hooksOf(result);
    expect(Object.keys(hooks)).toEqual([...HOOK_EVENTS]);
    for (const event of HOOK_EVENTS) {
      expect(hooks[event]).toHaveLength(1);
      const group = hooks[event]?.[0];
      expect(group).not.toHaveProperty("matcher");
      expect(group?.hooks).toHaveLength(1);
      expect(group?.hooks[0]?.command).toBe(HOOK_COMMAND);
      expect(group?.hooks[0]?.command).toBe("${CLAUDE_PROJECT_DIR}/.claude/hooks/agent-deck.sh");
    }
  });

  it("Stop läuft synchron mit timeout 5, alle anderen async", () => {
    const hooks = hooksOf(installHooks({}));
    expect(SYNC_HOOK_EVENTS).toEqual(["Stop"]);
    for (const event of HOOK_EVENTS) {
      const handler = hooks[event]?.[0]?.hooks[0];
      if (event === "Stop") {
        expect(handler).toEqual({ type: "command", command: HOOK_COMMAND, args: [], timeout: 5 });
        expect(handler).not.toHaveProperty("async");
      } else {
        expect(handler).toEqual({ type: "command", command: HOOK_COMMAND, args: [], async: true });
        expect(handler).not.toHaveProperty("timeout");
      }
    }
    expect(SYNC_HOOK_TIMEOUT_S).toBe(5);
  });

  it("lässt fremde Keys, Hooks, Gruppen und Matcher unverändert und hält die Reihenfolge", () => {
    const input = foreignSettings();
    const snapshot = structuredClone(input);
    const result = installHooks(input);
    expect(input).toEqual(snapshot); // Eingabe nicht verändert
    expect(Object.keys(result)).toEqual(["model", "hooks", "permissions"]);
    expect(result.permissions).toEqual(snapshot.permissions);
    const hooks = hooksOf(result);
    expect(Object.keys(hooks).slice(0, 3)).toEqual(["PreToolUse", "Stop", "WorktreeCreate"]);
    expect(hooks.PreToolUse?.[0]).toEqual({ matcher: "Bash", hooks: [foreign] });
    expect(hooks.PreToolUse?.[1]?.hooks[0]?.command).toBe(HOOK_COMMAND);
    expect(hooks.Stop?.[0]).toEqual({ hooks: [{ type: "command", command: "./notify.sh" }] });
    expect(hooks.Stop?.[1]?.hooks[0]?.timeout).toBe(5);
    expect(hooks.WorktreeCreate).toEqual(
      (snapshot.hooks as Record<string, unknown>).WorktreeCreate,
    );
  });

  it("ist idempotent", () => {
    const once = installHooks(foreignSettings());
    const twice = installHooks(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    const stop = hooksOf(twice).Stop ?? [];
    expect(stop.filter((g) => g.hooks.some((h) => h.command === HOOK_COMMAND))).toHaveLength(1);
  });

  it("korrigiert eigene Einträge mit abweichender Form statt sie zu verdoppeln", () => {
    const wrong = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: HOOK_COMMAND, async: true }] }],
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/agent-deck.sh' },
            ],
          },
          { hooks: [{ type: "command", command: HOOK_COMMAND, async: true, args: [] }] },
        ],
        // eigener Handler in fremder Gruppe mit Matcher → dort raus, eigene Gruppe neu
        PostToolUse: [
          { matcher: "Edit", hooks: [foreign, { type: "command", command: HOOK_COMMAND }] },
        ],
      },
    };
    const hooks = hooksOf(installHooks(wrong));
    expect(hooks.Stop).toEqual([
      { hooks: [{ type: "command", command: HOOK_COMMAND, args: [], timeout: 5 }] },
    ]);
    expect(hooks.PreToolUse).toEqual([
      { hooks: [{ type: "command", command: HOOK_COMMAND, args: [], async: true }] },
    ]);
    expect(hooks.PostToolUse).toEqual([
      { matcher: "Edit", hooks: [foreign] },
      { hooks: [{ type: "command", command: HOOK_COMMAND, args: [], async: true }] },
    ]);
  });

  it("migriert die Phase-0-Konfiguration: Altlasten raus, leere Events weg", () => {
    const result = installHooks(fixture());
    expect(result).toEqual(installHooks(emptySettings()));
    const text = JSON.stringify(result);
    expect(text).not.toContain("agent-deck-capture.sh");
    expect(text).not.toContain("queue-test.sh");
    // Reihenfolge der Events folgt der vorhandenen Datei
    expect(Object.keys(hooksOf(result)).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(Object.keys(hooksOf(result)).indexOf("PermissionRequest")).toBe(3);
  });

  it("lehnt ungültige Strukturen ab", () => {
    expect(() => installHooks([])).toThrow(/JSON-Objekt/);
    expect(() => installHooks({ hooks: [] })).toThrow(/"hooks"/);
    expect(() => installHooks({ hooks: { Stop: {} } })).toThrow(/hooks\.Stop/);
  });
});

describe("uninstallHooks", () => {
  it("entfernt nur unsere Handler, fremde bleiben", () => {
    const input = foreignSettings();
    const result = uninstallHooks(installHooks(input));
    expect(result).toEqual(input);
  });

  it("entfernt hooks ganz, wenn nichts übrig bleibt", () => {
    expect(uninstallHooks(installHooks(emptySettings()))).toEqual({ $schema: SETTINGS_SCHEMA_URL });
    expect(uninstallHooks(fixture())).toEqual({ $schema: SETTINGS_SCHEMA_URL });
  });

  it("ändert Einstellungen ohne eigene Hooks nicht", () => {
    expect(uninstallHooks(foreignSettings())).toEqual(foreignSettings());
    expect(uninstallHooks({})).toEqual({});
  });
});
