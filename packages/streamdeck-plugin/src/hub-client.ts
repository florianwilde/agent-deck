import { type Session, WsMessageSchema } from "@agent-deck/shared";
import WebSocket from "ws";
import type { ConnectionStatus } from "./settings.ts";

export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;

export interface HubConfig {
  hubUrl?: string | undefined;
  token?: string | undefined;
}

export interface HubClientOptions {
  /** Für Tests: kürzere Wartezeiten. */
  backoffMinMs?: number;
  backoffMaxMs?: number;
  /** Für Tests und Logs. */
  onLog?: (message: string) => void;
}

export type HubListener = (sessions: readonly Session[], status: ConnectionStatus) => void;

/**
 * Leitet aus der eingetragenen Hub-URL die Basis für REST und die WebSocket-URL ab.
 * Akzeptiert `http(s)://host:port`, auch mit `/ws` am Ende, und `ws(s)://…/ws`.
 */
export function hubEndpoints(hubUrl: string): { http: string; ws: string } | undefined {
  let url: URL;
  try {
    url = new URL(hubUrl.trim());
  } catch {
    return undefined;
  }
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return undefined;
  const path = url.pathname.replace(/\/+$/, "").replace(/\/ws$/, "");
  const host = url.host;
  return {
    http: `${secure ? "https" : "http"}://${host}${path}`,
    ws: `${secure ? "wss" : "ws"}://${host}${path}/ws`,
  };
}

/** Nächste Wartezeit: verdoppeln bis zum Maximum. */
export function nextBackoff(current: number, min = BACKOFF_MIN_MS, max = BACKOFF_MAX_MS): number {
  return current <= 0 ? min : Math.min(max, current * 2);
}

/**
 * Verbindung zum VPN-Listener des Hubs: `WS /ws` (Snapshot + Deltas), `POST /sessions/:id/ack`,
 * `GET /state` für „Verbindung testen“. Token als `Authorization: Bearer …`, auch beim Handshake.
 * Ohne Verbindung ist die Session-Liste leer und der Status nicht `connected`.
 */
export class HubClient {
  readonly #options: {
    backoffMinMs: number;
    backoffMaxMs: number;
    onLog: ((message: string) => void) | undefined;
  };
  readonly #listeners = new Set<HubListener>();
  readonly #sessions = new Map<string, Session>();
  #config: HubConfig = {};
  #socket: WebSocket | undefined;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #backoff = 0;
  #status: ConnectionStatus = { state: "unconfigured", sessions: 0 };
  #stopped = false;

  constructor(options: HubClientOptions = {}) {
    this.#options = {
      backoffMinMs: options.backoffMinMs ?? BACKOFF_MIN_MS,
      backoffMaxMs: options.backoffMaxMs ?? BACKOFF_MAX_MS,
      onLog: options.onLog,
    };
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  get sessions(): Session[] {
    return [...this.#sessions.values()];
  }

  subscribe(listener: HubListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Neue Einstellungen übernehmen; verbindet nur neu, wenn sich URL oder Token ändern. */
  configure(config: HubConfig): void {
    const same = config.hubUrl === this.#config.hubUrl && config.token === this.#config.token;
    this.#config = { hubUrl: config.hubUrl, token: config.token };
    if (same && this.#status.state !== "unconfigured") return;
    this.#stopped = false;
    this.#disconnect();
    this.#backoff = 0;
    this.#connect();
  }

  close(): void {
    this.#stopped = true;
    this.#disconnect();
    this.#setStatus({ state: "unconfigured", sessions: 0 });
  }

  /** `POST /sessions/:id/ack`. Liefert `false` bei Fehlern (Taste zeigt dann eine Warnung). */
  async acknowledge(id: string): Promise<boolean> {
    const endpoints = this.#endpoints();
    if (endpoints === undefined) return false;
    try {
      const response = await fetch(`${endpoints.http}/sessions/${encodeURIComponent(id)}/ack`, {
        method: "POST",
        headers: this.#headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** „Verbindung testen“: `GET /state` mit Token, unabhängig vom WebSocket. */
  async test(): Promise<{ ok: boolean; message: string }> {
    const endpoints = this.#endpoints();
    if (endpoints === undefined) {
      return { ok: false, message: this.#config.hubUrl ? "Hub-URL ungültig" : "Hub-URL fehlt" };
    }
    if (!this.#config.token) return { ok: false, message: "Token fehlt" };
    try {
      const response = await fetch(`${endpoints.http}/state`, {
        headers: this.#headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 401) return { ok: false, message: "Token abgelehnt (401)" };
      if (!response.ok) return { ok: false, message: `Hub antwortet ${response.status}` };
      const body = (await response.json()) as { sessions?: unknown[] };
      const count = Array.isArray(body.sessions) ? body.sessions.length : 0;
      return { ok: true, message: `OK · ${count} Session${count === 1 ? "" : "s"}` };
    } catch (error) {
      return { ok: false, message: `nicht erreichbar (${errorText(error)})` };
    }
  }

  #endpoints(): { http: string; ws: string } | undefined {
    return this.#config.hubUrl ? hubEndpoints(this.#config.hubUrl) : undefined;
  }

  #headers(): Record<string, string> {
    return { authorization: `Bearer ${this.#config.token ?? ""}` };
  }

  #connect(): void {
    if (this.#stopped) return;
    const endpoints = this.#endpoints();
    if (endpoints === undefined || !this.#config.token) {
      this.#clearSessions();
      this.#setStatus({
        state: "unconfigured",
        sessions: 0,
        ...(this.#config.hubUrl && endpoints === undefined ? { error: "Hub-URL ungültig" } : {}),
      });
      return;
    }
    this.#setStatus({ state: "connecting", sessions: 0, ...this.#lastError() });
    const socket = new WebSocket(endpoints.ws, {
      headers: this.#headers(),
      handshakeTimeout: REQUEST_TIMEOUT_MS,
    });
    this.#socket = socket;
    let error: string | undefined;

    socket.on("unexpected-response", (_request, response) => {
      error = response.statusCode === 401 ? "Token abgelehnt (401)" : `HTTP ${response.statusCode}`;
      socket.terminate();
    });
    socket.on("error", (err) => {
      error ??= errorText(err);
    });
    socket.on("open", () => {
      this.#backoff = 0;
      this.#options.onLog?.("Hub verbunden");
    });
    socket.on("message", (data) => {
      this.#handleMessage(data.toString());
    });
    socket.on("close", () => {
      if (this.#socket !== socket) return;
      this.#socket = undefined;
      this.#clearSessions();
      this.#setStatus({ state: "disconnected", sessions: 0, ...(error ? { error } : {}) });
      this.#scheduleReconnect();
    });
  }

  #handleMessage(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = WsMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.#options.onLog?.("Unbekannte Nachricht vom Hub verworfen");
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "snapshot":
        this.#sessions.clear();
        for (const session of message.sessions) this.#sessions.set(session.id, session);
        break;
      case "session.upsert":
        this.#sessions.set(message.session.id, message.session);
        break;
      case "session.remove":
        this.#sessions.delete(message.id);
        break;
    }
    this.#setStatus({ state: "connected", sessions: this.#sessions.size });
  }

  #scheduleReconnect(): void {
    if (this.#stopped) return;
    this.#backoff = nextBackoff(
      this.#backoff,
      this.#options.backoffMinMs,
      this.#options.backoffMaxMs,
    );
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      this.#connect();
    }, this.#backoff);
  }

  #disconnect(): void {
    if (this.#retryTimer !== undefined) clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    const socket = this.#socket;
    this.#socket = undefined;
    if (socket !== undefined) {
      socket.removeAllListeners();
      socket.on("error", () => undefined);
      socket.terminate();
    }
    this.#clearSessions();
  }

  #clearSessions(): void {
    this.#sessions.clear();
  }

  #lastError(): { error?: string } {
    return this.#status.error !== undefined && this.#status.state === "disconnected"
      ? { error: this.#status.error }
      : {};
  }

  #setStatus(status: ConnectionStatus): void {
    this.#status = status;
    const sessions = this.sessions;
    for (const listener of this.#listeners) listener(sessions, status);
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const code =
      (error as { cause?: { code?: unknown }; code?: unknown }).cause?.code ??
      (error as { code?: unknown }).code;
    return typeof code === "string" ? code : error.message;
  }
  return String(error);
}
