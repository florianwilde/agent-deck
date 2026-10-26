import type { Session } from "@agent-deck/shared";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Echter Hub im Normalbetrieb (HUB_MODE=normal), im selben Prozess auf freien Ports.
import { buildNormalApps } from "../../hub/src/app.ts";
import { loadConfig } from "../../hub/src/config.ts";
import { SessionHub } from "../../hub/src/normal/hub.ts";
import { SessionStore } from "../../hub/src/normal/store.ts";
import {
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  HubClient,
  hubEndpoints,
  nextBackoff,
} from "../src/hub-client.ts";
import type { ConnectionStatus } from "../src/settings.ts";

type FastifyInstance = Awaited<ReturnType<typeof buildNormalApps>>["vpnApp"];

const TOKEN = "t".repeat(40);
const VPN_TOKEN = "v".repeat(40);

let seq = 0;
function event(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    v: 1,
    event: name,
    sessionId: "cse_01ABC",
    repo: "florianwilde/agent-deck",
    ts: new Date(Date.now() - 1000 + seq).toISOString(),
    ...extra,
  };
}

/** Wartet, bis `check` wahr ist (max. 3 s). */
async function until(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("hubEndpoints", () => {
  it.each([
    ["http://10.1.5.229:8788", "http://10.1.5.229:8788", "ws://10.1.5.229:8788/ws"],
    ["http://10.1.5.229:8788/", "http://10.1.5.229:8788", "ws://10.1.5.229:8788/ws"],
    ["http://10.1.5.229:8788/ws", "http://10.1.5.229:8788", "ws://10.1.5.229:8788/ws"],
    ["wss://agent-deck.vpn.lan/ws", "https://agent-deck.vpn.lan", "wss://agent-deck.vpn.lan/ws"],
    ["https://host/hub/", "https://host/hub", "wss://host/hub/ws"],
    [" http://h:1 ", "http://h:1", "ws://h:1/ws"],
  ])("%s", (input, http, ws) => {
    expect(hubEndpoints(input)).toEqual({ http, ws });
  });

  it("lehnt ungültige URLs ab", () => {
    expect(hubEndpoints("10.1.5.229:8788")).toBeUndefined();
    expect(hubEndpoints("ftp://host")).toBeUndefined();
    expect(hubEndpoints("")).toBeUndefined();
  });
});

describe("nextBackoff", () => {
  it("verdoppelt von 1 s bis 30 s", () => {
    const steps: number[] = [];
    let current = 0;
    for (let i = 0; i < 8; i++) steps.push((current = nextBackoff(current)));
    expect(steps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(BACKOFF_MIN_MS).toBe(1000);
    expect(BACKOFF_MAX_MS).toBe(30000);
  });
});

describe("HubClient gegen lokalen Hub", () => {
  let hub: SessionHub;
  let publicApp: FastifyInstance;
  let vpnApp: FastifyInstance;
  let url: string;
  let client: HubClient;
  let statuses: ConnectionStatus[];

  async function startHub(port = 0): Promise<void> {
    hub = new SessionHub(new SessionStore(":memory:"));
    const config = loadConfig({
      HUB_MODE: "normal",
      HUB_TOKEN: TOKEN,
      HUB_VPN_TOKEN: VPN_TOKEN,
      HUB_DB_PATH: ":memory:",
    });
    ({ publicApp, vpnApp } = await buildNormalApps(config, hub, false));
    await vpnApp.listen({ port, host: "127.0.0.1" });
    url = `http://127.0.0.1:${(vpnApp.server.address() as AddressInfo).port}`;
  }

  async function stopHub(): Promise<void> {
    await vpnApp.close();
    await publicApp.close();
  }

  async function postEvent(body: Record<string, unknown>): Promise<void> {
    const response = await publicApp.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      payload: JSON.stringify(body),
    });
    expect(response.statusCode).toBe(202);
  }

  function sessions(): Session[] {
    return client.sessions;
  }

  beforeEach(async () => {
    await startHub();
    statuses = [];
    client = new HubClient({ backoffMinMs: 20, backoffMaxMs: 80 });
    client.subscribe((_sessions, status) => statuses.push(status));
  });

  afterEach(async () => {
    client.close();
    await stopHub();
  });

  it("ohne URL oder Token: unconfigured, keine Verbindung", () => {
    client.configure({ hubUrl: url });
    expect(client.status.state).toBe("unconfigured");
    client.configure({ token: VPN_TOKEN });
    expect(client.status.state).toBe("unconfigured");
    client.configure({ hubUrl: "kaputt", token: VPN_TOKEN });
    expect(client.status).toEqual({
      state: "unconfigured",
      sessions: 0,
      error: "Hub-URL ungültig",
    });
  });

  it("Snapshot, dann Upserts und Status", async () => {
    await postEvent(event("SessionStart", { sessionId: "cse_01OLD", repo: "florianwilde/sshkv" }));
    client.configure({ hubUrl: url, token: VPN_TOKEN });
    expect(client.status.state).toBe("connecting");
    await until(() => client.status.state === "connected");
    expect(sessions().map((s) => s.id)).toEqual(["cse_01OLD"]);

    await postEvent(event("SessionStart"));
    await until(() => sessions().length === 2);
    await postEvent(event("PermissionRequest", { message: "AskUserQuestion" }));
    await until(() => sessions().find((s) => s.id === "cse_01ABC")?.status === "needs_input");
    expect(client.status).toEqual({ state: "connected", sessions: 2 });
  });

  it("Quittieren per POST /sessions/:id/ack", async () => {
    await postEvent(event("SessionStart"));
    await postEvent(event("Stop"));
    client.configure({ hubUrl: url, token: VPN_TOKEN });
    await until(() => sessions().length === 1);
    expect(sessions()[0]?.acknowledged).toBe(false);
    expect(await client.acknowledge("cse_01ABC")).toBe(true);
    await until(() => sessions()[0]?.acknowledged === true);
    expect(await client.acknowledge("cse_01UNKNOWN")).toBe(false);
  });

  it("falscher Token: getrennt mit 401, versucht es weiter", async () => {
    client.configure({ hubUrl: url, token: "falsch" });
    await until(() => client.status.state === "disconnected");
    expect(client.status.error).toBe("Token abgelehnt (401)");
    const attempts = () => statuses.filter((s) => s.state === "connecting").length;
    await until(() => attempts() >= 3);
  });

  it("Reconnect nach Hub-Neustart, Sessions leer solange getrennt", async () => {
    await postEvent(event("SessionStart"));
    client.configure({ hubUrl: url, token: VPN_TOKEN });
    await until(() => sessions().length === 1);
    const port = Number(new URL(url).port);

    await stopHub();
    await until(() => client.status.state !== "connected");
    expect(sessions()).toEqual([]);

    await startHub(port);
    await postEvent(event("SessionStart", { sessionId: "cse_01NEW" }));
    await until(() => client.status.state === "connected");
    expect(sessions().map((s) => s.id)).toEqual(["cse_01NEW"]);
  });

  it("gleiche Einstellungen verbinden nicht neu", async () => {
    client.configure({ hubUrl: url, token: VPN_TOKEN });
    await until(() => client.status.state === "connected");
    const count = statuses.length;
    client.configure({ hubUrl: url, token: VPN_TOKEN });
    expect(statuses.length).toBe(count);
  });

  it("Verbindung testen", async () => {
    await postEvent(event("SessionStart"));
    client.configure({ hubUrl: url, token: VPN_TOKEN });
    expect(await client.test()).toEqual({ ok: true, message: "OK · 1 Session" });
    client.configure({ hubUrl: url, token: "falsch" });
    expect(await client.test()).toEqual({ ok: false, message: "Token abgelehnt (401)" });
    client.configure({ hubUrl: "http://127.0.0.1:1", token: VPN_TOKEN });
    const result = await client.test();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^nicht erreichbar/);
    client.configure({ token: VPN_TOKEN });
    expect(await client.test()).toEqual({ ok: false, message: "Hub-URL fehlt" });
  });
});
