import { accessSync, constants, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const HOOK_COMMAND = "${CLAUDE_PROJECT_DIR}/.claude/hooks/agent-deck-capture.sh";
const QUEUE_TEST_COMMAND = "${CLAUDE_PROJECT_DIR}/.claude/hooks/queue-test.sh";

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

describe(".claude/settings.json dieses Repos (Phase 0)", () => {
  it("registriert den Capture-Hook für die Kern-Events", () => {
    for (const event of [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "Notification",
      "Stop",
      "StopFailure",
      "SessionEnd",
    ]) {
      expect(settings.hooks[event]?.[0]?.hooks[0]?.command, event).toBe(HOOK_COMMAND);
    }
  });

  it("lässt Events aus, deren Hook das Standardverhalten ersetzt", () => {
    expect(settings.hooks).not.toHaveProperty("WorktreeCreate");
    expect(settings.hooks).not.toHaveProperty("WorktreeRemove");
  });

  it("blockiert Claude nie: alles async, nur SessionEnd synchron mit kurzem Timeout", () => {
    for (const [event, groups] of Object.entries(settings.hooks)) {
      for (const handler of groups.flatMap((group) => group.hooks)) {
        expect(handler.type).toBe("command");
        if (handler.command === QUEUE_TEST_COMMAND) continue;
        expect(handler.command).toBe(HOOK_COMMAND);
        if (event === "SessionEnd") {
          expect(handler.async).toBeUndefined();
          expect(handler.timeout).toBeLessThanOrEqual(5);
        } else {
          expect(handler.async, event).toBe(true);
        }
      }
    }
  });

  it("der Queue-Test-Hook (Phase 0 B) hängt nur an Stop, synchron mit kurzem Timeout", () => {
    for (const [event, groups] of Object.entries(settings.hooks)) {
      const queueHandlers = groups
        .flatMap((group) => group.hooks)
        .filter((handler) => handler.command === QUEUE_TEST_COMMAND);
      if (event !== "Stop") expect(queueHandlers, event).toHaveLength(0);
    }
    const stopQueue = settings.hooks.Stop?.flatMap((group) => group.hooks).find(
      (handler) => handler.command === QUEUE_TEST_COMMAND,
    );
    expect(stopQueue?.async).toBeUndefined();
    expect(stopQueue?.timeout).toBeLessThanOrEqual(5);
  });

  it("die Kopie in .claude/hooks/ entspricht packages/hook und ist ausführbar", () => {
    const installed = join(ROOT, ".claude", "hooks", "agent-deck-capture.sh");
    const source = join(ROOT, "packages", "hook", "agent-deck-capture.sh");
    expect(readFileSync(installed, "utf8")).toBe(readFileSync(source, "utf8"));
    expect(() => accessSync(installed, constants.X_OK)).not.toThrow();
  });
});
