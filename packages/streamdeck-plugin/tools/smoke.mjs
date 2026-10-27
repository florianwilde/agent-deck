// End-to-End-Smoke-Test des gebauten Plugins (bin/plugin.js) ohne Stream Deck:
// - startet einen echten Hub im Normalbetrieb (HUB_MODE=normal) auf freien Ports,
// - spielt die Stream-Deck-App über einen WebSocket-Server nach und startet das Plugin
//   mit denselben Argumenten wie die App (-port, -pluginUUID, -registerEvent, -info),
// - prüft Tastenbild, Statuswechsel, Kurzdruck (openUrl) und Langdruck (ack).
//
// Aufruf (nach `pnpm build`):  node tools/smoke.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(here, "..", "de.wildeflorian.agentdeck.sdPlugin");
const hubEntry = join(here, "..", "..", "hub", "src", "index.ts");
const ACTION = "de.wildeflorian.agentdeck.slot";
const TOKEN = "t".repeat(40);
const VPN_TOKEN = "v".repeat(40);

const failures = [];
const check = (ok, text) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
  if (!ok) failures.push(text);
};

const freePort = () =>
  new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

async function until(fn, text, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  check(false, `${text} (Timeout)`);
  return undefined;
}

// --- Hub --------------------------------------------------------------------
const [hubPort, vpnPort] = [await freePort(), await freePort()];
const dataDir = mkdtempSync(join(tmpdir(), "agent-deck-smoke-"));
const hub = spawn(
  process.execPath,
  ["--conditions=source", "--experimental-transform-types", "--no-warnings", hubEntry],
  {
    env: {
      ...process.env,
      HUB_MODE: "normal",
      HUB_TOKEN: TOKEN,
      HUB_VPN_TOKEN: VPN_TOKEN,
      HUB_HOST: "127.0.0.1",
      HUB_PORT: String(hubPort),
      HUB_VPN_PORT: String(vpnPort),
      HUB_DB_PATH: join(dataDir, "hub.db"),
      HUB_LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "inherit", "inherit"],
  },
);
process.on("exit", () => hub.kill());
await until(
  () =>
    fetch(`http://127.0.0.1:${vpnPort}/health`).then(
      (r) => r.ok,
      () => false,
    ),
  "Hub gestartet",
  15_000,
);
let seq = 0;
async function postEvent(event, extra = {}) {
  seq += 1;
  const response = await fetch(`http://127.0.0.1:${hubPort}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      v: 1,
      event,
      sessionId: "cse_01SMOKE",
      repo: "florianwilde/agent-deck",
      ts: new Date(Date.now() - 60_000 + seq).toISOString(),
      ...extra,
    }),
  });
  if (response.status !== 202) throw new Error(`POST /events: ${response.status}`);
}
await postEvent("SessionStart");

// --- Stream-Deck-App ---------------------------------------------------------
const fromPlugin = [];
const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await new Promise((resolve) => wss.once("listening", resolve));
let socket;
const send = (message) => socket.send(JSON.stringify(message));
wss.on("connection", (ws) => {
  socket = ws;
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    fromPlugin.push(message);
    if (message.event === "getGlobalSettings") {
      send({
        event: "didReceiveGlobalSettings",
        ...(message.id ? { id: message.id } : {}),
        payload: { settings: { hubUrl: `http://127.0.0.1:${vpnPort}`, token: VPN_TOKEN } },
      });
    }
  });
});
const info = {
  application: {
    font: "Segoe UI",
    language: "de",
    platform: "windows",
    platformVersion: "10.0.26100",
    version: "7.1.0.0",
  },
  plugin: { uuid: "de.wildeflorian.agentdeck", version: "0.1.0.0" },
  devicePixelRatio: 2,
  colors: {},
  devices: [{ id: "XL", name: "Stream Deck XL", size: { columns: 8, rows: 4 }, type: 2 }],
};
const plugin = spawn(
  process.execPath,
  [
    "bin/plugin.js",
    "-port",
    String(wss.address().port),
    "-pluginUUID",
    "de.wildeflorian.agentdeck",
    "-registerEvent",
    "registerPlugin",
    "-info",
    JSON.stringify(info),
  ],
  { cwd: pluginDir, stdio: ["ignore", "inherit", "inherit"] },
);

const images = (context) =>
  fromPlugin
    .filter((m) => m.event === "setImage" && m.context === context)
    .map((m) =>
      decodeURIComponent(
        String(m.payload.image).replace(/^data:image\/svg\+xml;charset=utf8,/, ""),
      ),
    );
const key = (context, column, settings = {}) => ({
  action: ACTION,
  context,
  device: "XL",
  payload: {
    controller: "Keypad",
    coordinates: { column, row: 0 },
    isInMultiAction: false,
    settings,
  },
});

try {
  check(
    !!(await until(() => fromPlugin.find((m) => m.event === "registerPlugin"), "registriert")),
    "Plugin registriert sich",
  );
  await until(() => fromPlugin.find((m) => m.event === "getGlobalSettings"), "getGlobalSettings");
  send({ event: "willAppear", ...key("k1", 0) });
  send({ event: "willAppear", ...key("k2", 1) });

  const working = await until(
    () => images("k1").find((svg) => svg.includes("ARBEITET")),
    "Arbeitet-Bild",
  );
  check(
    !!working && working.includes("agent-deck"),
    "Taste 1 zeigt die Session (ARBEITET, agent-deck)",
  );
  check(
    images("k2").length > 0 && !images("k2").at(-1).includes("<text"),
    "Taste 2 ist frei (leere Taste)",
  );

  // Property Inspector: Stream Deck kann sendToPlugin schicken, bevor propertyInspectorDidAppear kommt
  // (die sdpi-datasource fragt gleich beim Laden). Die Antwort darf dabei nicht verloren gehen.
  const toPi = () => fromPlugin.filter((m) => m.event === "sendToPropertyInspector");
  send({ event: "sendToPlugin", action: ACTION, context: "k1", payload: { event: "repos" } });
  send({ event: "sendToPlugin", action: ACTION, context: "k1", payload: { event: "getStatus" } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  send({ event: "propertyInspectorDidAppear", action: ACTION, context: "k1", device: "XL" });
  const repos = await until(() => toPi().find((m) => m.payload?.event === "repos"), "repos");
  check(
    repos?.context === "k1" && repos.payload.items?.[0]?.value === "florianwilde/agent-deck",
    "Repo-Liste kommt an, auch wenn der PI vor propertyInspectorDidAppear fragt",
  );
  check(
    !!toPi().find((m) => m.payload?.event === "status" && m.payload.status?.state === "connected"),
    "Status kommt an (verbunden)",
  );
  send({
    event: "sendToPlugin",
    action: ACTION,
    context: "k1",
    payload: { event: "repos", isRefresh: true },
  });
  check(
    !!(await until(
      () => toPi().filter((m) => m.payload?.event === "repos").length >= 2,
      "repos 2",
    )),
    "Repo-Liste bei offenem PI sofort",
  );
  send({ event: "propertyInspectorDidDisappear", action: ACTION, context: "k1", device: "XL" });

  await postEvent("PermissionRequest", { message: "AskUserQuestion" });
  check(
    !!(await until(() => images("k1").find((svg) => svg.includes("ANTWORT")), "Antwort-Bild")),
    "Rot bei Frage (ANTWORT)",
  );
  const blink = await until(
    () => images("k1").find((svg) => svg.includes("#8E2B2F")),
    "Blinkphase",
  );
  check(!!blink, "needs_input blinkt (Phase #8E2B2F)");

  send({ event: "keyDown", ...key("k1", 0) });
  send({ event: "keyUp", ...key("k1", 0) });
  const open = await until(() => fromPlugin.find((m) => m.event === "openUrl"), "openUrl");
  check(
    open?.payload?.url === "https://claude.ai/code/session_01SMOKE",
    `Kurzdruck öffnet ${open?.payload?.url}`,
  );

  send({ event: "keyDown", ...key("k1", 0) });
  await new Promise((resolve) => setTimeout(resolve, 700));
  send({ event: "keyUp", ...key("k1", 0) });
  await until(() => fromPlugin.find((m) => m.event === "showOk"), "showOk");
  const state = await fetch(`http://127.0.0.1:${vpnPort}/state`, {
    headers: { authorization: `Bearer ${VPN_TOKEN}` },
  }).then((r) => r.json());
  check(
    state.sessions[0]?.acknowledged === true,
    "Langdruck quittiert (acknowledged: true, showOk)",
  );
  check(fromPlugin.filter((m) => m.event === "openUrl").length === 1, "Langdruck öffnet nichts");

  await postEvent("Stop");
  check(
    !!(await until(() => images("k1").find((svg) => svg.includes("FERTIG")), "Fertig-Bild")),
    "Gelb bei fertig (FERTIG)",
  );

  hub.kill("SIGTERM");
  check(
    !!(await until(() => images("k1").at(-1)?.includes("OFFLINE"), "Offline-Bild")),
    "Hub weg → OFFLINE",
  );
  check(
    !JSON.stringify(fromPlugin).includes(VPN_TOKEN),
    "Token taucht in keiner Nachricht an Stream Deck auf",
  );
} finally {
  plugin.kill();
  hub.kill();
  wss.close();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(failures.length ? `\n${failures.length} Fehler` : "\nalles ok");
process.exit(failures.length ? 1 : 0);
