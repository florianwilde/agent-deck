import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOOK_EVENTS } from "@agent-deck/shared";
import { CliError, defaultHookSource, runInit } from "../src/init.ts";
import { main } from "../src/index.ts";
import { SETTINGS_SCHEMA_URL } from "../src/settings.ts";

const FIXTURE = new URL("./fixtures/phase-0-settings.json", import.meta.url);

let dir: string;
let repo: string;
let hookSource: string;
let lines: string[];

const settingsPath = () => path.join(repo, ".claude", "settings.json");
const hookPath = (name = "agent-deck.sh") => path.join(repo, ".claude", "hooks", name);
const readSettings = () =>
  JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Record<string, unknown>;
const writeSettings = (content: string) => {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), content);
};
const writeHookFile = (name: string) => {
  fs.mkdirSync(path.dirname(hookPath()), { recursive: true });
  fs.writeFileSync(hookPath(name), "#!/bin/sh\n");
};
const init = (uninstall = false) =>
  runInit({ target: repo, hookSource, uninstall, log: (l) => lines.push(l) });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deck-cli-"));
  repo = path.join(dir, "repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  hookSource = path.join(dir, "agent-deck.sh");
  fs.writeFileSync(hookSource, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o644 });
  lines = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("runInit", () => {
  it("legt eine fehlende settings.json an und kopiert den Hook mit 0755", () => {
    const result = init();
    const settings = readSettings();
    expect(settings.$schema).toBe(SETTINGS_SCHEMA_URL);
    expect(Object.keys(settings.hooks as object)).toEqual([...HOOK_EVENTS]);
    expect(fs.readFileSync(hookPath(), "utf8")).toBe(fs.readFileSync(hookSource, "utf8"));
    expect(fs.statSync(hookPath()).mode & 0o777).toBe(0o755);
    expect(result.backupPath).toBeUndefined();
    expect(fs.existsSync(`${settingsPath()}.bak`)).toBe(false);
    expect(lines.join("\n")).toContain("AGENT_DECK_URL");
    expect(lines.join("\n")).toContain("Network Secret");
  });

  it("schreibt 2-Space-JSON mit Newline am Ende", () => {
    init();
    const raw = fs.readFileSync(settingsPath(), "utf8");
    expect(raw).toBe(`${JSON.stringify(JSON.parse(raw), null, 2)}\n`);
  });

  it("behandelt eine leere Datei wie eine fehlende", () => {
    writeSettings("  \n");
    init();
    expect(readSettings().$schema).toBe(SETTINGS_SCHEMA_URL);
    expect(fs.existsSync(`${settingsPath()}.bak`)).toBe(false);
  });

  it("zweimal init ergibt dieselbe Datei, ohne neues Backup", () => {
    init();
    const first = fs.readFileSync(settingsPath(), "utf8");
    const second = init();
    expect(fs.readFileSync(settingsPath(), "utf8")).toBe(first);
    expect(second.settingsChanged).toBe(false);
    expect(fs.existsSync(`${settingsPath()}.bak`)).toBe(false);
    expect(lines).toContain(".claude/settings.json ist bereits aktuell.");
  });

  it("erhält fremde Einstellungen und legt ein Backup an", () => {
    const original = `${JSON.stringify(
      {
        env: { FOO: "1" },
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "x" }] }] },
      },
      null,
      4,
    )}`;
    writeSettings(original);
    fs.writeFileSync(`${settingsPath()}.bak`, "altes backup");
    const result = init();
    expect(result.backupPath).toBe(`${settingsPath()}.bak`);
    expect(fs.readFileSync(`${settingsPath()}.bak`, "utf8")).toBe(original);
    const settings = readSettings();
    expect(settings.env).toEqual({ FOO: "1" });
    expect(settings).not.toHaveProperty("$schema");
    const pre = (settings.hooks as Record<string, unknown[]>).PreToolUse ?? [];
    expect(pre[0]).toEqual({ matcher: "Bash", hooks: [{ type: "command", command: "x" }] });
    expect(pre).toHaveLength(2);
  });

  it("bricht bei kaputtem JSON ab und lässt alles unangetastet", () => {
    writeSettings('{ "hooks": ');
    expect(() => init()).toThrow(CliError);
    expect(() => init()).toThrow(/kein gültiges JSON/);
    expect(fs.readFileSync(settingsPath(), "utf8")).toBe('{ "hooks": ');
    expect(fs.existsSync(`${settingsPath()}.bak`)).toBe(false);
    expect(fs.existsSync(hookPath())).toBe(false);
  });

  it("migriert die Phase-0-Konfiguration und löscht Altlasten-Dateien", () => {
    writeSettings(fs.readFileSync(FIXTURE, "utf8"));
    writeHookFile("agent-deck-capture.sh");
    writeHookFile("queue-test.sh");
    writeHookFile("fremd.sh");
    init();
    const raw = fs.readFileSync(settingsPath(), "utf8");
    expect(raw).not.toMatch(/agent-deck-capture\.sh|queue-test\.sh/);
    expect(Object.keys(readSettings().hooks as object).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(fs.existsSync(hookPath("agent-deck-capture.sh"))).toBe(false);
    expect(fs.existsSync(hookPath("queue-test.sh"))).toBe(false);
    expect(fs.existsSync(hookPath("fremd.sh"))).toBe(true);
    expect(fs.readFileSync(`${settingsPath()}.bak`, "utf8")).toBe(fs.readFileSync(FIXTURE, "utf8"));
    expect(lines.some((l) => l.includes("agent-deck-capture.sh") && l.includes("Altlast"))).toBe(
      true,
    );
  });

  it("warnt ohne .git, bricht bei fehlendem Ziel oder Hook-Skript ab", () => {
    fs.rmSync(path.join(repo, ".git"), { recursive: true });
    init();
    expect(lines.some((l) => l.startsWith("Warnung:"))).toBe(true);
    expect(() => runInit({ target: path.join(dir, "fehlt"), hookSource, log: () => {} })).toThrow(
      /existiert nicht/,
    );
    expect(() =>
      runInit({ target: repo, hookSource: path.join(dir, "nope.sh"), log: () => {} }),
    ).toThrow(/Hook-Skript nicht gefunden/);
  });

  it("findet die Standard-Quelle in packages/hook", () => {
    expect(defaultHookSource()).toBe(
      path.resolve(import.meta.dirname, "..", "..", "hook", "agent-deck.sh"),
    );
  });
});

describe("runInit --uninstall", () => {
  it("entfernt nur unsere Einträge und Dateien, fremdes bleibt", () => {
    const foreign = {
      model: "opus",
      hooks: { Stop: [{ hooks: [{ type: "command", command: "./notify.sh" }] }] },
    };
    writeSettings(JSON.stringify(foreign));
    writeHookFile("fremd.sh");
    init();
    const installed = fs.readFileSync(settingsPath(), "utf8");
    init(true);
    expect(readSettings()).toEqual(foreign);
    expect(fs.readFileSync(`${settingsPath()}.bak`, "utf8")).toBe(installed);
    expect(fs.existsSync(hookPath())).toBe(false);
    expect(fs.existsSync(hookPath("fremd.sh"))).toBe(true);
  });

  it("entfernt hooks komplett und das leere hooks-Verzeichnis", () => {
    init();
    init(true);
    expect(readSettings()).toEqual({ $schema: SETTINGS_SCHEMA_URL });
    expect(fs.existsSync(path.dirname(hookPath()))).toBe(false);
  });

  it("räumt auch Phase-0-Altlasten ab", () => {
    writeSettings(fs.readFileSync(FIXTURE, "utf8"));
    writeHookFile("agent-deck-capture.sh");
    init(true);
    expect(readSettings()).toEqual({ $schema: SETTINGS_SCHEMA_URL });
    expect(fs.existsSync(hookPath("agent-deck-capture.sh"))).toBe(false);
  });

  it("legt ohne settings.json keine Datei an", () => {
    init(true);
    expect(fs.existsSync(settingsPath())).toBe(false);
  });
});

describe("main (argv)", () => {
  const run = (...argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = main(argv, { out: (l) => out.push(l), err: (l) => err.push(l), cwd: repo });
    return { code, out: out.join("\n"), err: err.join("\n") };
  };

  it("--help gibt die Hilfe aus", () => {
    const r = run("--help");
    expect(r.code).toBe(0);
    expect(r.out).toContain("agent-deck init");
  });

  it("falscher Aufruf → Exit 2", () => {
    expect(run().code).toBe(2);
    expect(run("deinit").code).toBe(2);
    expect(run("init", "a", "b").code).toBe(2);
    expect(run("init", "--foo").code).toBe(2);
  });

  it("kaputtes JSON → Exit 1 mit Meldung", () => {
    writeSettings("{nope");
    const r = run("init", "--uninstall");
    expect(r.code).toBe(1);
    expect(r.err).toContain("kein gültiges JSON");
  });

  it("init --uninstall ohne Pfad nutzt cwd", () => {
    writeSettings(fs.readFileSync(FIXTURE, "utf8"));
    const r = run("init", "-u");
    expect(r.code).toBe(0);
    expect(readSettings()).toEqual({ $schema: SETTINGS_SCHEMA_URL });
  });
});
