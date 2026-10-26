import { HOOK_EVENTS, SYNC_HOOK_EVENTS, SYNC_HOOK_TIMEOUT_S } from "@agent-deck/shared";
import { accessSync, constants, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const HOOK_COMMAND = "${CLAUDE_PROJECT_DIR}/.claude/hooks/agent-deck.sh";

interface HookHandler {
  type: string;
  command: string;
  async?: boolean;
  timeout?: number;
}
interface Settings {
  hooks: Record<string, { matcher?: string; hooks: HookHandler[] }[]>;
}

const settings = JSON.parse(
  readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"),
) as Settings;

describe(".claude/settings.json dieses Repos (ab Phase 1, per agent-deck init)", () => {
  it("registriert genau die Events aus docs/event-mapping.md", () => {
    expect(Object.keys(settings.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
  });

  it("nur unser Hook; Stop synchron mit kurzem Timeout, alles andere async", () => {
    for (const [event, groups] of Object.entries(settings.hooks)) {
      const handlers = groups.flatMap((group) => group.hooks);
      expect(handlers, event).toHaveLength(1);
      const [handler] = handlers;
      expect(handler?.type).toBe("command");
      expect(handler?.command).toBe(HOOK_COMMAND);
      if ((SYNC_HOOK_EVENTS as readonly string[]).includes(event)) {
        expect(handler?.async, event).toBeUndefined();
        expect(handler?.timeout, event).toBeLessThanOrEqual(SYNC_HOOK_TIMEOUT_S);
      } else {
        expect(handler?.async, event).toBe(true);
      }
    }
  });

  it("die Kopie in .claude/hooks/ entspricht packages/hook und ist ausführbar", () => {
    const installed = join(ROOT, ".claude", "hooks", "agent-deck.sh");
    const source = join(ROOT, "packages", "hook", "agent-deck.sh");
    expect(readFileSync(installed, "utf8")).toBe(readFileSync(source, "utf8"));
    expect(() => accessSync(installed, constants.X_OK)).not.toThrow();
  });

  it("Capture-Hook und Queue-Test aus Phase 0 sind entfernt", () => {
    expect(readdirSync(join(ROOT, ".claude", "hooks"))).toEqual(["agent-deck.sh"]);
    expect(existsSync(join(ROOT, ".claude", "queue-test-pending"))).toBe(false);
  });
});
