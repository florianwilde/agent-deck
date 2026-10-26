import { STATUS_PRIORITY, type HookEvent, type Session, type WsMessage } from "@agent-deck/shared";
import { applyEvent, applyTimeouts, toSession, type SessionRecord } from "./engine.ts";
import type { SessionStore } from "./store.ts";

export type HubListener = (message: WsMessage) => void;

export interface IngestResult {
  /** `false`, wenn das Event ignoriert oder als veraltet verworfen wurde. */
  applied: boolean;
  /** Gesetzt, wenn sich der Status geändert hat. */
  statusChanged: boolean;
  session?: Session;
}

/** Hält den Stand aller Sessions, persistiert ihn und meldet jede Änderung an die Listener. */
export class SessionHub {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly listeners = new Set<HubListener>();

  constructor(private readonly store: SessionStore) {
    for (const record of store.load()) this.sessions.set(record.id, record);
  }

  subscribe(listener: HubListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sessions nach Priorität des Status, dann Repo. */
  list(): Session[] {
    return [...this.sessions.values()]
      .map(toSession)
      .sort(
        (a, b) =>
          STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] ||
          a.repo.localeCompare(b.repo) ||
          a.id.localeCompare(b.id),
      );
  }

  get(id: string): Session | undefined {
    const record = this.sessions.get(id);
    return record === undefined ? undefined : toSession(record);
  }

  ingest(event: HookEvent, now = new Date()): IngestResult {
    const previous = this.sessions.get(event.sessionId);
    const next = applyEvent(previous, event, now);
    if (next === null) return { applied: false, statusChanged: false };
    this.put(next);
    return {
      applied: true,
      statusChanged: previous?.status !== next.status,
      session: toSession(next),
    };
  }

  /** Quittiert eine Session (Taste gedrückt). `undefined`, wenn sie unbekannt ist. */
  acknowledge(id: string): Session | undefined {
    const record = this.sessions.get(id);
    if (record === undefined) return undefined;
    if (!record.acknowledged) this.put({ ...record, acknowledged: true });
    return this.get(id);
  }

  /** Wendet die Timeouts auf alle Sessions an; regelmäßig aufrufen. */
  tick(now = new Date()): void {
    for (const record of [...this.sessions.values()]) {
      const result = applyTimeouts(record, now);
      if (result.action === "update") this.put(result.session);
      else if (result.action === "remove") this.remove(record.id);
    }
  }

  private put(record: SessionRecord): void {
    const previous = this.sessions.get(record.id);
    this.sessions.set(record.id, record);
    this.store.save(record);
    // Tool-Events kommen im Sekundentakt; nur senden, wenn sich mehr als die Zeitstempel ändert.
    if (previous === undefined || !sameExceptTimestamps(previous, record)) {
      this.emit({ type: "session.upsert", session: toSession(record) });
    }
  }

  private remove(id: string): void {
    this.sessions.delete(id);
    this.store.delete(id);
    this.emit({ type: "session.remove", id });
  }

  private emit(message: WsMessage): void {
    for (const listener of this.listeners) listener(message);
  }
}

function sameExceptTimestamps(a: SessionRecord, b: SessionRecord): boolean {
  const strip = ({ lastEventAt, lastSeenAt, ...rest }: SessionRecord) => {
    void lastEventAt;
    void lastSeenAt;
    return rest;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
