import { WsMessageSchema, type Session, type WsMessage } from "@agent-deck/shared";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildNormalApps } from "../src/app.ts";
import { loadConfig, type HubConfig } from "../src/config.ts";
import { SessionHub } from "../src/normal/hub.ts";
import { SessionStore } from "../src/normal/store.ts";

const TOKEN = "t".repeat(40);
const VPN_TOKEN = "v".repeat(40);
const publicAuth = { authorization: `Bearer ${TOKEN}` };
const vpnAuth = { authorization: `Bearer ${VPN_TOKEN}` };

function config(env: Record<string, string> = {}): HubConfig {
  return loadConfig({
    HUB_MODE: "normal",
    HUB_TOKEN: TOKEN,
    HUB_VPN_TOKEN: VPN_TOKEN,
    HUB_DB_PATH: ":memory:",
    ...env,
  });
}

let seq = 0;
function event(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    v: 1,
    event: name,
    sessionId: "cse_01ABC",
    repo: "florianwilde/agent-deck",
    ts: new Date(Date.UTC(2026, 9, 26, 12, 0, 0, seq)).toISOString(),
    ...extra,
  };
}

describe("Normalbetrieb", () => {
  let store: SessionStore;
  let hub: SessionHub;
  let publicApp: FastifyInstance;
  let vpnApp: FastifyInstance;

  async function setup(env: Record<string, string> = {}): Promise<void> {
    store = new SessionStore(":memory:");
    hub = new SessionHub(store);
    ({ publicApp, vpnApp } = await buildNormalApps(config(env), hub, false));
  }

  async function post(body: unknown, headers: Record<string, string> = publicAuth) {
    return publicApp.inject({
      method: "POST",
      url: "/events",
      headers: { ...headers, "content-type": "application/json" },
      payload: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  async function state(): Promise<Session[]> {
    const res = await vpnApp.inject({ method: "GET", url: "/state", headers: vpnAuth });
    expect(res.statusCode).toBe(200);
    return res.json<{ sessions: Session[] }>().sessions;
  }

  beforeEach(async () => {
    await setup();
  });

  afterEach(async () => {
    await publicApp.close();
    await vpnApp.close();
    store.close();
  });

  it("Frage → needs_input, Antwort → working, Ende → done", async () => {
    expect((await post(event("SessionStart", { source: "startup" }))).statusCode).toBe(202);
    expect((await state())[0]).toMatchObject({
      id: "cse_01ABC",
      url: "https://claude.ai/code/session_01ABC",
      status: "working",
    });

    await post(event("PermissionRequest", { message: "AskUserQuestion" }));
    expect((await state())[0]).toMatchObject({
      status: "needs_input",
      lastMessage: "AskUserQuestion",
    });

    await post(event("PostToolUse"));
    await post(event("Stop"));
    expect((await state())[0]?.status).toBe("done");
  });

  it("verwirft unbekannte Felder und kürzt die Meldung", async () => {
    await post(
      event("Notification", {
        notificationType: "permission_prompt",
        message: "x".repeat(500),
        prompt: "geheimer Prompt",
        tool_input: { command: "rm -rf /" },
      }),
    );
    const [session] = await state();
    expect(session?.lastMessage).toHaveLength(120);
    expect(JSON.stringify(session)).not.toMatch(/geheim|rm -rf/);
  });

  it("lehnt ungültige Events mit 400 ab", async () => {
    for (const body of [
      "{kaputt",
      {},
      event("Stop", { v: 2 }),
      event("Stop", { sessionId: "../etc" }),
      event("Stop", { ts: "gestern" }),
      event("Stop", { event: "Stop; rm" }),
    ]) {
      const res = await post(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await state()).toEqual([]);
  });

  it("verlangt den öffentlichen Token für POST /events", async () => {
    for (const headers of [{}, { authorization: "Bearer falsch" }, vpnAuth]) {
      expect((await post(event("Stop"), headers)).statusCode).toBe(401);
    }
  });

  it("lehnt Bodies über 4 KB ab", async () => {
    const res = await post(event("Stop", { padding: "a".repeat(5000) }));
    expect(res.statusCode).toBe(413);
  });

  it("begrenzt POST /events pro IP und Minute", async () => {
    await publicApp.close();
    await vpnApp.close();
    store.close();
    await setup({ HUB_RATE_LIMIT: "3" });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await post(event("PreToolUse"))).statusCode);
    expect(codes).toEqual([202, 202, 202, 429, 429]);
    // /health ist nicht begrenzt.
    expect((await publicApp.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  it("öffentlicher Listener hat keine VPN-Endpunkte, VPN-Listener kein /events", async () => {
    expect(
      (await publicApp.inject({ method: "GET", url: "/state", headers: vpnAuth })).statusCode,
    ).toBe(404);
    expect(
      (await publicApp.inject({ method: "POST", url: "/sessions/cse_01ABC/ack", headers: vpnAuth }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await vpnApp.inject({
          method: "POST",
          url: "/events",
          headers: publicAuth,
          payload: event("Stop"),
        })
      ).statusCode,
    ).toBe(404);
  });

  it("VPN-Endpunkte verlangen den VPN-Token, /health nicht", async () => {
    for (const headers of [{}, publicAuth]) {
      expect((await vpnApp.inject({ method: "GET", url: "/state", headers })).statusCode).toBe(401);
      expect(
        (await vpnApp.inject({ method: "POST", url: "/sessions/cse_01ABC/ack", headers }))
          .statusCode,
      ).toBe(401);
    }
    const health = await vpnApp.inject({ method: "GET", url: "/health" });
    expect(health.json()).toEqual({ ok: true, mode: "normal" });
  });

  it("POST /sessions/:id/ack quittiert, ein neues Event hebt das auf", async () => {
    await post(event("Stop"));
    const ack = await vpnApp.inject({
      method: "POST",
      url: "/sessions/cse_01ABC/ack",
      headers: vpnAuth,
    });
    expect(ack.statusCode).toBe(200);
    expect((await state())[0]?.acknowledged).toBe(true);

    await post(event("UserPromptSubmit"));
    expect((await state())[0]?.acknowledged).toBe(false);

    const unknown = await vpnApp.inject({
      method: "POST",
      url: "/sessions/cse_X/ack",
      headers: vpnAuth,
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("GET /state sortiert nach Priorität", async () => {
    await post(event("PreToolUse", { sessionId: "cse_A", repo: "a/working" }));
    await post(event("Stop", { sessionId: "cse_B", repo: "b/done" }));
    await post(event("PermissionRequest", { sessionId: "cse_C", repo: "c/input" }));
    expect((await state()).map((s) => s.status)).toEqual(["needs_input", "done", "working"]);
  });

  describe("WS /ws", () => {
    let url: string;
    const sockets: WebSocket[] = [];

    beforeEach(async () => {
      await vpnApp.listen({ host: "127.0.0.1", port: 0 });
      url = `ws://127.0.0.1:${(vpnApp.server.address() as AddressInfo).port}/ws`;
    });

    afterEach(() => {
      for (const socket of sockets) socket.terminate();
      sockets.length = 0;
    });

    function connect(headers: Record<string, string> = vpnAuth) {
      const socket = new WebSocket(url, { headers });
      sockets.push(socket);
      const messages: WsMessage[] = [];
      const waiters: (() => void)[] = [];
      socket.on("message", (data: Buffer) => {
        messages.push(WsMessageSchema.parse(JSON.parse(data.toString("utf8"))));
        for (const wake of waiters.splice(0)) wake();
      });
      const next = async (count: number): Promise<WsMessage[]> => {
        while (messages.length < count) await new Promise<void>((resolve) => waiters.push(resolve));
        return messages.slice(0, count);
      };
      return { socket, next };
    }

    it("schickt Snapshot und danach jede Änderung", async () => {
      await post(event("SessionStart", { source: "startup" }));
      const client = connect();
      const [snapshot] = await client.next(1);
      expect(snapshot).toMatchObject({ type: "snapshot", sessions: [{ status: "working" }] });

      await post(event("PreToolUse")); // nur Zeitstempel ändern sich → keine Nachricht
      await post(event("Stop"));
      const messages = await client.next(2);
      expect(messages[1]).toMatchObject({ type: "session.upsert", session: { status: "done" } });

      const idleAt = Date.now() + 31 * 60_000;
      hub.tick(new Date(idleAt)); // 30 Min. still → idle
      hub.tick(new Date(idleAt + 24 * 60 * 60_000)); // 24 h idle → entfernen
      const all = await client.next(4);
      expect(all.slice(2).map((m) => m.type)).toEqual(["session.upsert", "session.remove"]);
    });

    it("lehnt Verbindungen ohne VPN-Token ab", async () => {
      for (const headers of [{}, publicAuth]) {
        const { socket } = connect(headers);
        const status = await new Promise<number | undefined>((resolve) => {
          socket.on("unexpected-response", (_req, res) => resolve(res.statusCode));
          socket.on("open", () => resolve(101));
          socket.on("error", () => resolve(undefined));
        });
        expect(status).toBe(401);
      }
    });
  });
});

describe("Persistenz", () => {
  it("ein Neustart behält den Stand", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-deck-hub-"));
    const path = join(dir, "hub.db");
    try {
      const first = new SessionStore(path);
      const hub = new SessionHub(first);
      hub.ingest({
        v: 1,
        event: "PermissionRequest",
        sessionId: "cse_01ABC",
        repo: "florianwilde/agent-deck",
        ts: "2026-10-26T12:00:00.000Z",
        message: "AskUserQuestion",
      });
      first.close();

      const second = new SessionStore(path);
      expect(new SessionHub(second).list()).toMatchObject([
        { id: "cse_01ABC", status: "needs_input", lastMessage: "AskUserQuestion" },
      ]);
      expect(second.captureRows()).toBe(0);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
