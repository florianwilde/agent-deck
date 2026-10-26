import type { Session } from "@agent-deck/shared";
import type { HubListener } from "./hub-client.ts";
import { emptyKey, formatSince, projectKey } from "./render/index.ts";
import type { ConnectionStatus, GlobalSettings, SlotSettings } from "./settings.ts";
import {
  type SlotAssignment,
  type SlotInfo,
  assignSlots,
  displayName,
  openTarget,
} from "./slots.ts";

export const LONG_PRESS_MS = 600;
export const BLINK_MS = 600;
export const DOT_MS = 500;
/** Takt, in dem der Deck-Zustand neu berechnet wird; gesendet wird nur, wenn sich ein Bild ändert. */
export const TICK_MS = 100;
const DEFAULT_INACTIVE_MIN = 30;

/** Was der Deck vom Hub-Client braucht (für Tests austauschbar). */
export interface HubLike {
  readonly sessions: Session[];
  readonly status: ConnectionStatus;
  subscribe(listener: HubListener): () => void;
  acknowledge(id: string): Promise<boolean>;
}

/** Eine Taste auf dem Gerät (für Tests austauschbar). */
export interface KeyHandle {
  setImage(svg: string): Promise<void> | void;
  showOk(): Promise<void> | void;
  showAlert(): Promise<void> | void;
}

export interface DeckOptions {
  hub: HubLike;
  openUrl: (url: string) => Promise<void> | void;
  now?: () => number;
}

interface SlotEntry {
  info: SlotInfo;
  key: KeyHandle;
  /** Zuletzt gesendetes Bild. */
  image: string | undefined;
  /** Zuletzt gezeigter Name (für die Offline-Anzeige). */
  lastName: string | undefined;
  pressTimer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Hält alle sichtbaren Slot-Tasten, verteilt die Sessions darauf und zeichnet nur Tasten neu,
 * deren Bild sich ändert (Blinken 600 ms, Punkte 500 ms, Zeitangabe minütlich).
 */
export class Deck {
  readonly #hub: HubLike;
  readonly #openUrl: DeckOptions["openUrl"];
  readonly #now: () => number;
  readonly #slots = new Map<string, SlotEntry>();
  #global: GlobalSettings = {};
  #assignments = new Map<string, SlotAssignment>();
  #ticker: ReturnType<typeof setInterval> | undefined;
  #unsubscribe: (() => void) | undefined;

  constructor(options: DeckOptions) {
    this.#hub = options.hub;
    this.#openUrl = options.openUrl;
    this.#now = options.now ?? Date.now;
  }

  start(): void {
    this.#unsubscribe ??= this.#hub.subscribe(() => this.render());
    this.#ticker ??= setInterval(() => this.render(), TICK_MS);
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    if (this.#ticker !== undefined) clearInterval(this.#ticker);
    this.#ticker = undefined;
    for (const entry of this.#slots.values()) this.#clearPress(entry);
  }

  setGlobalSettings(settings: GlobalSettings): void {
    this.#global = settings;
    this.render();
  }

  addSlot(info: SlotInfo, key: KeyHandle): void {
    const previous = this.#slots.get(info.id);
    if (previous) this.#clearPress(previous);
    this.#slots.set(info.id, {
      info,
      key,
      image: undefined,
      lastName: previous?.lastName,
      pressTimer: undefined,
    });
    this.render();
  }

  updateSlotSettings(id: string, settings: SlotSettings): void {
    const entry = this.#slots.get(id);
    if (entry === undefined) return;
    entry.info = { ...entry.info, settings };
    entry.lastName = undefined;
    this.render();
  }

  removeSlot(id: string): void {
    const entry = this.#slots.get(id);
    if (entry) this.#clearPress(entry);
    this.#slots.delete(id);
    this.render();
  }

  /** Repos für die Auswahl „Fest“ im Property Inspector: bekannte Sessions plus bereits gewählte. */
  repos(): string[] {
    const repos = new Set(this.#hub.sessions.map((session) => session.repo));
    for (const entry of this.#slots.values())
      if (entry.info.settings.repo) repos.add(entry.info.settings.repo);
    return [...repos].sort((a, b) => a.localeCompare(b));
  }

  keyDown(id: string): void {
    const entry = this.#slots.get(id);
    if (entry === undefined) return;
    this.#clearPress(entry);
    entry.pressTimer = setTimeout(() => {
      entry.pressTimer = undefined;
      void this.#longPress(entry);
    }, LONG_PRESS_MS);
  }

  keyUp(id: string): void {
    const entry = this.#slots.get(id);
    if (entry?.pressTimer === undefined) return; // langer Druck wurde schon ausgelöst
    this.#clearPress(entry);
    const view = this.#connected() ? this.#assignments.get(id)?.view : undefined;
    void this.#openUrl(openTarget(view, this.#global.openIn));
  }

  /** Alle Tasten berechnen und geänderte Bilder senden. */
  render(): void {
    const now = this.#now();
    const connected = this.#connected();
    const infos = [...this.#slots.values()].map((entry) => entry.info);
    this.#assignments = connected
      ? assignSlots(infos, this.#hub.sessions, now, this.#inactiveMs())
      : new Map();
    for (const entry of this.#slots.values()) {
      const image = this.#image(entry, now, connected);
      if (image === entry.image) continue;
      entry.image = image;
      void entry.key.setImage(image);
    }
  }

  #image(entry: SlotEntry, now: number, connected: boolean): string {
    const settings = entry.info.settings;
    if (!connected) {
      const fixedName =
        settings.mode === "fixed" && settings.repo
          ? displayName(settings.repo, settings)
          : undefined;
      return projectKey("offline", {
        name: fixedName ?? entry.lastName ?? "agent-deck",
        since: "–",
        pinned: settings.mode === "fixed",
      });
    }
    const assignment = this.#assignments.get(entry.info.id);
    const view = assignment?.view;
    if (view === undefined) return emptyKey();
    const name = displayName(view.session.repo, settings);
    entry.lastName = name;
    const blinking = view.status === "needs_input" && !view.session.acknowledged;
    return projectKey(view.status, {
      name,
      since: formatSince(new Date(view.since).toISOString(), now),
      queue: view.session.queueCount,
      count: assignment?.count ?? 1,
      blinkPhase: blinking ? (Math.floor(now / BLINK_MS) % 2 === 0 ? 0 : 1) : 0,
      dot: (Math.floor(now / DOT_MS) % 3) as 0 | 1 | 2,
      pinned: settings.mode === "fixed",
    });
  }

  async #longPress(entry: SlotEntry): Promise<void> {
    const view = this.#connected() ? this.#assignments.get(entry.info.id)?.view : undefined;
    if (view === undefined) {
      await entry.key.showAlert();
      return;
    }
    const ok = await this.#hub.acknowledge(view.session.id);
    await (ok ? entry.key.showOk() : entry.key.showAlert());
  }

  #clearPress(entry: SlotEntry): void {
    if (entry.pressTimer !== undefined) clearTimeout(entry.pressTimer);
    entry.pressTimer = undefined;
  }

  #connected(): boolean {
    return this.#hub.status.state === "connected";
  }

  #inactiveMs(): number {
    const minutes = Number.parseInt(this.#global.inactiveMinutes ?? "", 10);
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_INACTIVE_MIN) * 60_000;
  }
}
