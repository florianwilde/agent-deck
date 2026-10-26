import { HookEventSchema, type HookEvent, type Status } from "@agent-deck/shared";
import { describe, expect, it } from "vitest";
import {
  applyEvent,
  applyTimeouts,
  statusForEvent,
  type SessionRecord,
} from "../src/normal/engine.ts";

const ID = "cse_01ABC";
const T0 = new Date("2026-10-26T12:00:00.000Z");
const MIN = 60_000;

function at(ms: number): Date {
  return new Date(T0.getTime() + ms);
}

function ev(event: string, extra: Partial<HookEvent> = {}, ts = T0): HookEvent {
  return HookEventSchema.parse({
    v: 1,
    event,
    sessionId: ID,
    repo: "florianwilde/agent-deck",
    ts: ts.toISOString(),
    ...extra,
  });
}

function record(status: Status, overrides: Partial<SessionRecord> = {}): SessionRecord {
  const session = applyEvent(undefined, ev("UserPromptSubmit"), T0);
  if (session === null) throw new Error("unreachable");
  return { ...session, status, ...overrides };
}

describe("statusForEvent – jede Zeile aus docs/event-mapping.md", () => {
  it.each<[string, Partial<HookEvent>, Status | null]>([
    ["PermissionRequest", { message: "AskUserQuestion" }, "needs_input"],
    ["Notification", { notificationType: "permission_prompt" }, "needs_input"],
    ["Notification", { notificationType: "idle_prompt" }, "needs_input"],
    ["Notification", { notificationType: "elicitation_dialog" }, "needs_input"],
    ["Notification", { notificationType: "elicitation_url_dialog" }, "needs_input"],
    ["Notification", { notificationType: "agent_needs_input" }, "needs_input"],
    ["Notification", { notificationType: "auth_success" }, null],
    ["Notification", { notificationType: "agent_completed" }, null],
    ["Notification", {}, null],
    ["Stop", {}, "done"],
    ["StopFailure", { message: "rate_limit" }, "error"],
    ["SessionStart", { source: "startup" }, "working"],
    ["SessionStart", { source: "compact" }, "working"],
    ["SessionStart", { source: "resume" }, "idle"],
    ["SessionStart", { source: "clear" }, "idle"],
    ["UserPromptSubmit", {}, "working"],
    ["PreToolUse", {}, "working"],
    ["PostToolUse", {}, "working"],
    ["PostToolUseFailure", {}, "working"],
    ["PostToolBatch", {}, "working"],
    ["PreCompact", {}, "working"],
    ["PostCompact", {}, "working"],
    ["SessionEnd", { source: "other" }, "idle"],
    ["Setup", {}, null],
    ["SubagentStart", {}, null],
    ["SubagentStop", {}, null],
    ["MessageDisplay", {}, null],
    ["InstructionsLoaded", {}, null],
    ["CwdChanged", {}, null],
    ["ConfigChange", {}, null],
    ["FileChanged", {}, null],
    ["TaskCreated", {}, null],
  ])("%s %j → %s", (name, extra, expected) => {
    expect(statusForEvent(ev(name, extra))).toBe(expected);
  });

  it("Stop mit stop_hook_active ist trotzdem done (Feld wird gar nicht übertragen)", () => {
    expect(statusForEvent(ev("Stop"))).toBe("done");
  });
});

describe("applyEvent", () => {
  it("legt eine neue Session mit URL, Repo und Status an", () => {
    const session = applyEvent(
      undefined,
      ev("SessionStart", { source: "startup", branch: "main" }),
      T0,
    );
    expect(session).toEqual({
      id: ID,
      repo: "florianwilde/agent-deck",
      branch: "main",
      url: "https://claude.ai/code/session_01ABC",
      status: "working",
      since: T0.toISOString(),
      lastEventAt: T0.toISOString(),
      lastMessage: null,
      queueCount: 0,
      acknowledged: false,
      lastPromptAt: null,
      lastSeenAt: T0.toISOString(),
      endedAt: null,
    });
  });

  it("Fallback-Key ohne cse_ öffnet die Übersicht", () => {
    const session = applyEvent(undefined, ev("Stop", { sessionId: "a213d775-1fda" }), T0);
    expect(session?.url).toBe("https://claude.ai/code");
  });

  it("ignorierte Events legen keine Session an und ändern keine", () => {
    expect(applyEvent(undefined, ev("SubagentStop"), T0)).toBeNull();
    expect(applyEvent(record("done"), ev("SubagentStop", {}, at(1000)), at(1000))).toBeNull();
  });

  it("verwirft Events, die älter sind als der aktuelle Stand", () => {
    const done = applyEvent(record("working"), ev("Stop", {}, at(5000)), at(5000));
    expect(done?.status).toBe("done");
    if (done === null) return;
    // PostToolUse mit älterem Hook-Zeitstempel kommt verspätet an.
    expect(applyEvent(done, ev("PostToolUse", {}, at(4000)), at(6000))).toBeNull();
    // Gleicher Zeitstempel wird angenommen.
    expect(applyEvent(done, ev("PreToolUse", {}, at(5000)), at(6000))?.status).toBe("working");
  });

  it("Frage → needs_input mit Tool-Name, Antwort → working, Ende → done", () => {
    let s: SessionRecord | null = record("working");
    s = applyEvent(s, ev("PermissionRequest", { message: "AskUserQuestion" }, at(1000)), at(1000));
    expect(s).toMatchObject({ status: "needs_input", lastMessage: "AskUserQuestion" });
    s = applyEvent(
      s ?? undefined,
      ev(
        "Notification",
        {
          notificationType: "permission_prompt",
          message: "Claude needs your permission to use AskUserQuestion",
        },
        at(7000),
      ),
      at(7000),
    );
    expect(s).toMatchObject({
      status: "needs_input",
      since: at(1000).toISOString(),
      lastMessage: "Claude needs your permission to use AskUserQuestion",
    });
    s = applyEvent(s ?? undefined, ev("PostToolUse", {}, at(60_000)), at(60_000));
    expect(s).toMatchObject({
      status: "working",
      lastMessage: null,
      since: at(60_000).toISOString(),
    });
    s = applyEvent(s ?? undefined, ev("Stop", {}, at(70_000)), at(70_000));
    expect(s).toMatchObject({ status: "done", since: at(70_000).toISOString() });
  });

  it("StopFailure setzt error mit Fehlertext", () => {
    const s = applyEvent(
      record("working"),
      ev("StopFailure", { message: "overloaded" }, at(1)),
      at(1),
    );
    expect(s).toMatchObject({ status: "error", lastMessage: "overloaded" });
  });

  it("neue Events setzen acknowledged zurück", () => {
    const s = applyEvent(
      record("done", { acknowledged: true }),
      ev("PreToolUse", {}, at(1)),
      at(1),
    );
    expect(s?.acknowledged).toBe(false);
  });

  it("merkt sich den Zeitpunkt des letzten Prompts", () => {
    const s = applyEvent(record("done"), ev("UserPromptSubmit", {}, at(5000)), at(5000));
    expect(s?.lastPromptAt).toBe(at(5000).toISOString());
    const later = applyEvent(s ?? undefined, ev("PreToolUse", {}, at(6000)), at(6000));
    expect(later?.lastPromptAt).toBe(at(5000).toISOString());
  });

  it("SessionEnd setzt idle und endedAt, ein späteres Event hebt es auf", () => {
    const ended = applyEvent(record("done"), ev("SessionEnd", { source: "clear" }, at(1)), at(1));
    expect(ended).toMatchObject({ status: "idle", endedAt: at(1).toISOString() });
    const restarted = applyEvent(
      ended ?? undefined,
      ev("SessionStart", { source: "clear" }, at(2)),
      at(2),
    );
    expect(restarted).toMatchObject({ status: "idle", endedAt: null });
  });

  it("behält den Branch, wenn ein Event keinen mitbringt", () => {
    const s = applyEvent(record("working", { branch: "main" }), ev("Stop", {}, at(1)), at(1));
    expect(s?.branch).toBe("main");
  });
});

describe("applyTimeouts", () => {
  it("working → idle nach 10 Min. ohne Event", () => {
    const s = record("working");
    expect(applyTimeouts(s, at(10 * MIN - 1))).toEqual({ action: "keep" });
    const result = applyTimeouts(s, at(10 * MIN));
    expect(result).toMatchObject({
      action: "update",
      session: { status: "idle", since: at(10 * MIN).toISOString() },
    });
  });

  it.each<Status>(["needs_input", "done", "error"])(
    "%s → idle nach 30 Min. ohne Event",
    (status) => {
      const s = record(status, { lastMessage: "x" });
      expect(applyTimeouts(s, at(29 * MIN))).toEqual({ action: "keep" });
      expect(applyTimeouts(s, at(30 * MIN))).toMatchObject({
        action: "update",
        session: { status: "idle", lastMessage: null },
      });
    },
  );

  it("idle wird nach 24 h entfernt (archivierte Sessions)", () => {
    const s = record("idle", { since: at(30 * MIN).toISOString() });
    expect(applyTimeouts(s, at(30 * MIN + 24 * 60 * MIN - 1))).toEqual({ action: "keep" });
    expect(applyTimeouts(s, at(30 * MIN + 24 * 60 * MIN))).toEqual({ action: "remove" });
  });

  it("nach SessionEnd 10 Min. später entfernen", () => {
    const ended = applyEvent(record("done"), ev("SessionEnd", {}, at(0)), at(0));
    if (ended === null) throw new Error("unreachable");
    expect(applyTimeouts(ended, at(10 * MIN - 1))).toEqual({ action: "keep" });
    expect(applyTimeouts(ended, at(10 * MIN))).toEqual({ action: "remove" });
  });

  it("misst die Stille an der Hub-Zeit, nicht am Hook-Zeitstempel", () => {
    // Hook-Uhr geht 1 h nach, das Event kam aber gerade erst an.
    const s = record("working", {
      lastEventAt: at(-60 * MIN).toISOString(),
      lastSeenAt: T0.toISOString(),
    });
    expect(applyTimeouts(s, at(MIN))).toEqual({ action: "keep" });
  });
});
