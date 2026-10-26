import { accessSync, constants, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const HOOK_COMMAND = "${CLAUDE_PROJECT_DIR}/.claude/hooks/agent-deck-capture.sh";

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

  it("die Kopie in .claude/hooks/ entspricht packages/hook und ist ausführbar", () => {
    const installed = join(ROOT, ".claude", "hooks", "agent-deck-capture.sh");
    const source = join(ROOT, "packages", "hook", "agent-deck-capture.sh");
    expect(readFileSync(installed, "utf8")).toBe(readFileSync(source, "utf8"));
    expect(() => accessSync(installed, constants.X_OK)).not.toThrow();
  });
});
