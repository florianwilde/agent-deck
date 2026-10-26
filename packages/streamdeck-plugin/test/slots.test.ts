import type { Session, Status } from "@agent-deck/shared";
import { describe, expect, it } from "vitest";
import type { SlotSettings } from "../src/settings.ts";
import { type SlotInfo, assignSlots, displayName, openTarget, viewSession } from "../src/slots.ts";

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const MIN = 60_000;
const INACTIVE = 30 * MIN;

function session(
  id: string,
  status: Status,
  sinceMinAgo: number,
  extra: Partial<Session> = {},
): Session {
  const since = new Date(NOW - sinceMinAgo * MIN).toISOString();
  return {
    id,
    repo: `florianwilde/${id}`,
    branch: null,
    url: `https://claude.ai/code/session_${id}`,
    status,
    since,
    lastEventAt: since,
    lastMessage: null,
    queueCount: 0,
    acknowledged: false,
    lastPromptAt: null,
    ...extra,
  };
}

function slot(
  id: string,
  row: number,
  column: number,
  settings: SlotSettings = {},
  device = "XL",
): SlotInfo {
  return { id, device, row, column, settings };
}

function ids(map: ReturnType<typeof assignSlots>, slots: string[]): (string | undefined)[] {
  return slots.map((id) => map.get(id)?.view?.session.id);
}

describe("assignSlots", () => {
  const sessions = [
    session("work", "working", 2),
    session("idle", "idle", 60),
    session("done-new", "done", 1),
    session("ask", "needs_input", 4),
    session("err", "error", 1),
    session("done-old", "done", 12),
  ];

  it("sortiert nach Status-Priorität, dann since (ältester zuerst), Tasten nach Zeile, dann Spalte", () => {
    // Absichtlich ungeordnet angemeldet.
    const slots = [
      slot("c", 1, 0),
      slot("a", 0, 0),
      slot("b", 0, 1),
      slot("e", 2, 0),
      slot("d", 1, 1),
      slot("f", 2, 1),
      slot("g", 3, 0),
    ];
    const result = assignSlots(slots, sessions, NOW, INACTIVE);
    expect(ids(result, ["a", "b", "c", "d", "e", "f", "g"])).toEqual([
      "ask",
      "done-old",
      "done-new",
      "err",
      "work",
      "idle",
      undefined,
    ]);
    expect(result.get("g")).toEqual({ view: undefined, count: 0 });
    expect(result.get("a")?.count).toBe(1);
  });

  it("Position n zeigt die n.-dringendste Session, die übrigen Slots füllen die freien Ränge", () => {
    const slots = [
      slot("a", 0, 0),
      slot("b", 0, 1, { position: "1" }),
      slot("c", 0, 2),
      slot("d", 0, 3, { position: "6" }),
    ];
    const result = assignSlots(slots, sessions, NOW, INACTIVE);
    expect(ids(result, ["a", "b", "c", "d"])).toEqual(["done-old", "ask", "done-new", "idle"]);
  });

  it("feste Slots zeigen ihr Repo und nehmen es aus der automatischen Verteilung", () => {
    const two = [...sessions, session("ask2", "done", 3, { repo: "florianwilde/ask" })];
    const slots = [
      slot("a", 0, 0),
      slot("fix", 0, 1, { mode: "fixed", repo: "florianwilde/ask" }),
      slot("b", 0, 2),
    ];
    const result = assignSlots(slots, two, NOW, INACTIVE);
    expect(result.get("fix")).toMatchObject({ view: { session: { id: "ask" } }, count: 2 });
    expect(ids(result, ["a", "b"])).toEqual(["done-old", "done-new"]);
  });

  it("fester Slot ohne passende Session bleibt leer", () => {
    const result = assignSlots(
      [slot("fix", 0, 0, { mode: "fixed", repo: "x/y" })],
      sessions,
      NOW,
      INACTIVE,
    );
    expect(result.get("fix")).toEqual({ view: undefined, count: 0 });
  });

  it("sortiert Geräte getrennt hintereinander", () => {
    const slots = [slot("b1", 0, 0, {}, "B"), slot("a1", 1, 0, {}, "A"), slot("a0", 0, 0, {}, "A")];
    const result = assignSlots(slots, sessions, NOW, INACTIVE);
    expect(ids(result, ["a0", "a1", "b1"])).toEqual(["ask", "done-old", "done-new"]);
  });
});

describe("viewSession (lokaler Inaktiv-Timeout)", () => {
  it("zeigt idle, wenn das letzte Event länger her ist als der Timeout", () => {
    const view = viewSession(session("s", "done", 20), NOW, 15 * MIN);
    expect(view.status).toBe("idle");
    expect(view.since).toBe(NOW - 20 * MIN + 15 * MIN);
  });

  it("lässt jüngere Sessions und idle unverändert", () => {
    expect(viewSession(session("s", "done", 10), NOW, 15 * MIN).status).toBe("done");
    expect(viewSession(session("s", "idle", 120), NOW, 15 * MIN)).toMatchObject({
      status: "idle",
      since: NOW - 120 * MIN,
    });
  });
});

describe("displayName und openTarget", () => {
  it("Repo ohne Besitzer, außer es gibt einen Anzeigenamen", () => {
    expect(displayName("florianwilde/agent-deck", {})).toBe("agent-deck");
    expect(displayName("lokal", {})).toBe("lokal");
    expect(displayName("florianwilde/agent-deck", { displayName: "  Deck " })).toBe("Deck");
    expect(displayName("florianwilde/agent-deck", { displayName: "  " })).toBe("agent-deck");
  });

  it("Session-URL im Browser, claude:// für die App, sonst die Übersicht", () => {
    const view = viewSession(session("01ABC", "done", 1), NOW, INACTIVE);
    expect(openTarget(view, undefined)).toBe("https://claude.ai/code/session_01ABC");
    expect(openTarget(view, "browser")).toBe("https://claude.ai/code/session_01ABC");
    expect(openTarget(view, "app")).toBe("claude://claude.ai/code/session_01ABC");
    expect(openTarget(undefined, "browser")).toBe("https://claude.ai/code");
    expect(openTarget(undefined, "app")).toBe("claude://claude.ai/code");
  });
});
