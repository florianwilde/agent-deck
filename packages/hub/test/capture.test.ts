import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { CaptureStore, sanitizeHeaders } from "../src/capture/store.ts";
import { loadConfig, type HubConfig } from "../src/config.ts";

const TOKEN = "t".repeat(40);
const auth = { authorization: `Bearer ${TOKEN}` };

function config(overrides: Partial<HubConfig> = {}): HubConfig {
  return { ...loadConfig({ HUB_TOKEN: TOKEN, HUB_DB_PATH: ":memory:" }), ...overrides };
}

describe("capture mode", () => {
  let store: CaptureStore;
  let app: FastifyInstance;

  beforeEach(() => {
    store = new CaptureStore(":memory:");
    app = buildApp(config({ bodyLimit: 1024 }), { captureStore: store }, false);
  });

  afterEach(async () => {
    await app.close();
    store.close();
  });

  it("speichert den Body unverändert, ohne Authorization-Header", async () => {
    const body = '{"payload": {"hook_event_name":"Stop"},   "env": {"A":"1"}}';
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: { ...auth, "content-type": "application/json", "x-test": "yes", cookie: "c=1" },
      payload: body,
    });
    expect(res.statusCode).toBe(202);

    const [entry] = store.list(new Date(0).toISOString(), 10);
    expect(entry?.body).toBe(body);
    expect(entry?.headers["x-test"]).toBe("yes");
    expect(entry?.headers).not.toHaveProperty("authorization");
    expect(entry?.headers).not.toHaveProperty("cookie");
    expect(Date.parse(entry?.receivedAt ?? "")).not.toBeNaN();
  });

  it("nimmt auch kaputtes JSON und andere Content-Types an", async () => {
    for (const [type, payload] of [
      ["application/json", "{kaputt"],
      ["text/plain", "hallo"],
    ] as const) {
      const res = await app.inject({
        method: "POST",
        url: "/events",
        headers: { ...auth, "content-type": type },
        payload,
      });
      expect(res.statusCode).toBe(202);
    }
    const res = await app.inject({ method: "GET", url: "/capture", headers: auth });
    const entries = res.json<{ entries: { body: string; json: unknown }[] }>().entries;
    expect(entries.map((e) => e.body)).toEqual(["{kaputt", "hallo"]);
    expect(entries.map((e) => e.json)).toEqual([null, null]);
  });

  it("verlangt den Bearer-Token für POST /events und GET /capture", async () => {
    for (const headers of [{}, { authorization: "Bearer falsch" }, { authorization: TOKEN }]) {
      const post = await app.inject({ method: "POST", url: "/events", headers, payload: "{}" });
      expect(post.statusCode).toBe(401);
      const get = await app.inject({ method: "GET", url: "/capture", headers });
      expect(get.statusCode).toBe(401);
    }
    expect(store.list(new Date(0).toISOString(), 10)).toHaveLength(0);
  });

  it("lehnt zu große Bodies ab", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/events",
      headers: { ...auth, "content-type": "application/json" },
      payload: JSON.stringify({ x: "a".repeat(2000) }),
    });
    expect(res.statusCode).toBe(413);
  });

  it("GET /capture filtert nach since und liefert geparstes JSON", async () => {
    store.insert({
      receivedAt: "2026-01-01T10:00:00.000Z",
      remoteAddress: "1.1.1.1",
      headers: {},
      body: '{"n":1}',
    });
    store.insert({
      receivedAt: "2026-01-01T12:00:00.000Z",
      remoteAddress: "1.1.1.1",
      headers: {},
      body: '{"n":2}',
    });

    const all = await app.inject({ method: "GET", url: "/capture", headers: auth });
    expect(all.json<{ count: number }>().count).toBe(2);

    const later = await app.inject({
      method: "GET",
      url: "/capture?since=2026-01-01T11:00:00Z",
      headers: auth,
    });
    const body = later.json<{ count: number; entries: { json: unknown }[] }>();
    expect(body.count).toBe(1);
    expect(body.entries[0]?.json).toEqual({ n: 2 });
  });

  it("GET /capture prüft since und limit", async () => {
    const bad = await app.inject({ method: "GET", url: "/capture?since=gestern", headers: auth });
    expect(bad.statusCode).toBe(400);
    const badLimit = await app.inject({ method: "GET", url: "/capture?limit=0", headers: auth });
    expect(badLimit.statusCode).toBe(400);
  });

  it("GET /health braucht keinen Token", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toEqual({ ok: true, mode: "capture" });
  });
});

describe("loadConfig", () => {
  it("verlangt einen ausreichend langen Token", () => {
    expect(() => loadConfig({})).toThrow(/HUB_TOKEN/);
    expect(() => loadConfig({ HUB_TOKEN: "kurz" })).toThrow(/HUB_TOKEN/);
  });

  it("prüft HUB_MODE und Zahlen", () => {
    expect(() => loadConfig({ HUB_TOKEN: TOKEN, HUB_MODE: "x" })).toThrow(/HUB_MODE/);
    expect(() => loadConfig({ HUB_TOKEN: TOKEN, HUB_PORT: "abc" })).toThrow(/HUB_PORT/);
    expect(loadConfig({ HUB_TOKEN: TOKEN, HUB_PORT: "9000" }).port).toBe(9000);
  });

  it("HUB_MODE=normal ist in Phase 0 noch nicht verfügbar", () => {
    const store = new CaptureStore(":memory:");
    expect(() => buildApp(config({ mode: "normal" }), { captureStore: store }, false)).toThrow(
      /Phase 1/,
    );
    store.close();
  });
});

describe("sanitizeHeaders", () => {
  it("entfernt Auth-Header unabhängig von der Schreibweise", () => {
    expect(
      sanitizeHeaders({ Authorization: "x", "Proxy-Authorization": "y", host: "h", a: undefined }),
    ).toEqual({ host: "h" });
  });
});
