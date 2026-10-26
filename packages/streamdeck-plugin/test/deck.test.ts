import type { Session } from "@agent-deck/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Deck, type HubLike, type KeyHandle } from "../src/deck.ts";
import type { HubListener } from "../src/hub-client.ts";
import { emptyKey, projectKey } from "../src/render/index.ts";
import type { ConnectionStatus } from "../src/settings.ts";

const T0 = Date.parse("2026-10-26T12:00:00.000Z");

function session(extra: Partial<Session> = {}): Session {
  return {
    id: "cse_01ABC",
    repo: "florianwilde/agent-deck",
    branch: "main",
    url: "https://claude.ai/code/session_01ABC",
    status: "needs_input",
    since: new Date(T0 - 4 * 60_000).toISOString(),
    lastEventAt: new Date(T0 - 4 * 60_000).toISOString(),
    lastMessage: null,
    queueCount: 0,
    acknowledged: false,
    lastPromptAt: null,
    ...extra,
  };
}

class FakeHub implements HubLike {
  sessions: Session[] = [];
  status: ConnectionStatus = { state: "connected", sessions: 0 };
  acked: string[] = [];
  ackResult = true;
  readonly #listeners = new Set<HubListener>();
  subscribe(listener: HubListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  acknowledge(id: string): Promise<boolean> {
    this.acked.push(id);
    return Promise.resolve(this.ackResult);
  }
  emit(
    sessions: Session[],
    status: ConnectionStatus = { state: "connected", sessions: sessions.length },
  ): void {
    this.sessions = sessions;
    this.status = status;
    for (const listener of this.#listeners) listener(sessions, status);
  }
}

class FakeKey implements KeyHandle {
  images: string[] = [];
  oks = 0;
  alerts = 0;
  setImage(svg: string): void {
    this.images.push(svg);
  }
  showOk(): void {
    this.oks++;
  }
  showAlert(): void {
    this.alerts++;
  }
  get last(): string | undefined {
    return this.images.at(-1);
  }
}

describe("Deck", () => {
  let hub: FakeHub;
  let opened: string[];
  let deck: Deck;
  let key: FakeKey;

  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    hub = new FakeHub();
    opened = [];
    deck = new Deck({ hub, openUrl: (url) => void opened.push(url) });
    key = new FakeKey();
    deck.start();
  });

  afterEach(() => {
    deck.stop();
    vi.useRealTimers();
  });

  it("zeichnet beim Erscheinen und zeigt freie Slots leer", () => {
    deck.addSlot({ id: "k1", device: "XL", row: 0, column: 0, settings: {} }, key);
    expect(key.images).toEqual([emptyKey()]);
  });

  it("ohne Hub-Verbindung zeigen alle Slots offline, mit zuletzt bekanntem Namen", () => {
    hub.emit([session({ status: "done" })]);
    deck.addSlot({ id: "k1", device: "XL", row: 0, column: 0, settings: {} }, key);
    const fixed = new FakeKey();
    deck.addSlot(
      { id: "k2", device: "XL", row: 0, column: 1, settings: { mode: "fixed", repo: "a/sshkv" } },
      fixed,
    );
    const free = new FakeKey();
    deck.addSlot({ id: "k3", device: "XL", row: 0, column: 2, settings: {} }, free);

    hub.emit([], { state: "disconnected", sessions: 0, error: "ECONNREFUSED" });
    expect(key.last).toBe(projectKey("offline", { name: "agent-deck", since: "–", pinned: false }));
    expect(fixed.last).toBe(projectKey("offline", { name: "sshkv", since: "–", pinned: true }));
    expect(free.last).toBe(
      projectKey("offline", { name: "agent-deck", since: "–", pinned: false }),
    );
  });

  it("needs_input blinkt im 600-ms-Takt und sendet nur geänderte Bilder", () => {
    hub.emit([session()]);
    deck.addSlot({ id: "k1", device: "XL", row: 0, column: 0, settings: {} }, key);
    const phase0 = projectKey("needs_input", {
      name: "agent-deck",
      since: "4m",
      queue: 0,
      count: 1,
      blinkPhase: 0,
      dot: 0,
      pinned: false,
    });
    const phase1 = projectKey("needs_input", {
      name: "agent-deck",
      since: "4m",
      queue: 0,
      count: 1,
      blinkPhase: 1,
      dot: 1,
      pinned: false,
    });
    expect(key.images).toEqual([phase0]);
    // dot ändert sich bei needs_input nicht am Bild; erst die Blinkphase wechselt nach 600 ms.
    vi.advanceTimersByTime(500);
    expect(key.images).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(key.images).toHaveLength(2);
    expect(key.last).toBe(phase1);
    vi.advanceTimersByTime(600);
    expect(key.images).toHaveLength(3);
    expect(key.last).toBe(phase0);
  });

  it("quittiert: kein Blinken mehr", () => {
    hub.emit([session({ acknowledged: true })]);
    deck.addSlot({ id: "k1", device: "XL", row: 0, column: 0, settings: {} }, key);
    vi.advanceTimersByTime(3000);
    expect(key.images).toHaveLength(1);
  });

  it("working: Punkte wandern alle 500 ms", () => {
    hub.emit([session({ status: "working" })]);
    deck.addSlot({ id: "k1", device: "XL", row: 0, column: 0, settings: {} }, key);
    vi.advanceTimersByTime(1500);
    expect(key.images).toHaveLength(4);
    expect(new Set(key.images).size).toBe(3);
  });

  it("done: Zeitangabe aktualisiert sich jede Minute, sonst kein neues Bild", () => {
    hub.emit([session({ status: "done" })]);
    deck.addSlot({ id: "k1", device: "XL", row: 0, column: 0, settings: {} }, key);
    expect(key.last).toContain("FERTIG · 4m");
    vi.advanceTimersByTime(59_000);
    expect(key.images).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(key.images).toHaveLength(2);
    expect(key.last).toContain("FERTIG · 5m");
  });

  it("Anzeigename, Queue-Zähler und Pin bei fester Belegung", () => {
    hub.emit([session({ status: "done", queueCount: 2 })]);
    deck.addSlot(
      {
        id: "k1",
        device: "XL",
        row: 0,
        column: 0,
        settings: { mode: "fixed", repo: "florianwilde/agent-deck", displayName: "Deck" },
      },
      key,
    );
    expect(key.last).toBe(
      projectKey("done", {
        name: "Deck",
        since: "4m",
        queue: 2,
        count: 1,
        blinkPhase: 0,
        dot: 0,
        pinned: true,
      }),
    );
  });

  it("kurzer Druck öffnet die Session, mit claude:// für die App", () => {
    hub.emit([session()]);
    deck.addSlot({ id: "k1", device: "XL", row: 0, column: 0, settings: {} }, key);
    deck.keyDown("k1");
    vi.advanceTimersByTime(200);
    deck.keyUp("k1");
    deck.setGlobalSettings({ openIn: "app" });
    deck.keyDown("k1");
    deck.keyUp("k1");
    expect(opened).toEqual([
      "https://claude.ai/code/session_01ABC",
      "claude://claude.ai/code/session_01ABC",
    ]);
    expect(hub.acked).toEqual([]);
  });

  it("kurzer Druck auf freien oder Offline-Slot öffnet claude.ai/code", () => {
    deck.addSlot({ id: "k1", device: "XL", row: 0, column: 0, settings: {} }, key);
    deck.keyDown("k1");
    deck.keyUp("k1");
    hub.emit([session()], { state: "disconnected", sessions: 0 });
    deck.keyDown("k1");
    deck.keyUp("k1");
    expect(opened).toEqual(["https://claude.ai/code", "https://claude.ai/code"]);
  });

  it("langer Druck (≥ 600 ms) quittiert und öffnet nichts", async () => {
    hub.emit([session()]);
    deck.addSlot({ id: "k1", device: "XL", row: 0, column: 0, settings: {} }, key);
    deck.keyDown("k1");
    await vi.advanceTimersByTimeAsync(600);
    deck.keyUp("k1");
    expect(hub.acked).toEqual(["cse_01ABC"]);
    expect(key.oks).toBe(1);
    expect(opened).toEqual([]);
  });

  it("langer Druck: Warnung, wenn das Quittieren scheitert oder keine Session da ist", async () => {
    hub.ackResult = false;
    hub.emit([session()]);
    deck.addSlot({ id: "k1", device: "XL", row: 0, column: 0, settings: {} }, key);
    deck.keyDown("k1");
    await vi.advanceTimersByTimeAsync(600);
    expect(key.alerts).toBe(1);

    const free = new FakeKey();
    deck.addSlot({ id: "k2", device: "XL", row: 0, column: 1, settings: {} }, free);
    deck.keyDown("k2");
    await vi.advanceTimersByTimeAsync(600);
    expect(free.alerts).toBe(1);
  });

  it("Einstellungen ändern verteilt neu, Entfernen gibt den Rang frei", () => {
    hub.emit([session(), session({ id: "cse_02", repo: "a/sshkv", status: "working" })]);
    const second = new FakeKey();
    deck.addSlot({ id: "k1", device: "XL", row: 0, column: 0, settings: {} }, key);
    deck.addSlot({ id: "k2", device: "XL", row: 0, column: 1, settings: {} }, second);
    expect(second.last).toContain("sshkv");
    deck.updateSlotSettings("k2", { position: "1" });
    expect(second.last).toContain("agent-deck");
    expect(key.last).toContain("sshkv");
    deck.removeSlot("k2");
    expect(key.last).toContain("agent-deck");
  });

  it("repos(): bekannte Sessions plus fest gewählte, sortiert", () => {
    hub.emit([session(), session({ id: "cse_02", repo: "a/sshkv" })]);
    deck.addSlot(
      { id: "k1", device: "XL", row: 0, column: 0, settings: { mode: "fixed", repo: "z/alt" } },
      key,
    );
    expect(deck.repos()).toEqual(["a/sshkv", "florianwilde/agent-deck", "z/alt"]);
  });
});
