// Prüft den Property Inspector (ui/slot.html) im Browser, ohne Stream Deck:
// Ein kleiner WebSocket-Server spielt die Stream-Deck-App, die Seite wird über
// connectElgatoStreamDeckSocket() verbunden wie in der echten App.
//
// Aufruf:  NODE_PATH=$(npm root -g) node packages/streamdeck-plugin/tools/pi-check.mjs
// (Playwright ist global installiert.) sdpi-components liegt unter ui/vendor/.
// Ergebnis: Screenshot tools/pi-preview.png, Exit-Code 1 bei Fehlern.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { WebSocketServer } = require("ws");

const here = dirname(fileURLToPath(import.meta.url));
const page_ = join(here, "..", "de.wildeflorian.agentdeck.sdPlugin", "ui", "slot.html");
const screenshot = join(here, "pi-preview.png");

const ACTION = "de.wildeflorian.agentdeck.slot";
const received = []; // alle Nachrichten der Seite an "Stream Deck"
const failures = [];
const check = (ok, text) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
  if (!ok) failures.push(text);
};

// --- Fake-Stream-Deck --------------------------------------------------------
const wss = new WebSocketServer({ port: 0 });
const port = wss.address().port;
wss.on("connection", (ws) => {
  const toPi = (payload) =>
    ws.send(
      JSON.stringify({ event: "sendToPropertyInspector", action: ACTION, context: "ctx", payload }),
    );
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    received.push(msg);
    if (msg.event === "getGlobalSettings") {
      ws.send(
        JSON.stringify({
          event: "didReceiveGlobalSettings",
          payload: {
            settings: { hubUrl: "http://10.1.5.229:8788", token: "geheim", sound: "once" },
          },
        }),
      );
    } else if (msg.event === "sendToPlugin") {
      const ev = msg.payload?.event;
      if (ev === "getStatus")
        toPi({ event: "status", status: { state: "connected", sessions: 7 } });
      if (ev === "testConnection")
        toPi({ event: "testResult", ok: true, message: "Hub erreichbar" });
      if (ev === "repos")
        toPi({
          event: "repos",
          items: [
            { label: "agent-deck", value: "florianwilde/agent-deck" },
            { label: "homelab", value: "florianwilde/homelab" },
          ],
        });
    }
  });
});

// --- Browser ----------------------------------------------------------------
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 360, height: 760 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(pathToFileURL(page_).href);
check(await page.evaluate(() => !!window.SDPIComponents), "sdpi-components geladen");

const actionInfo = {
  action: ACTION,
  context: "ctx",
  device: "dev",
  payload: { settings: { mode: "auto", position: "3" }, coordinates: { column: 0, row: 0 } },
};
const info = { application: { language: "de", platform: "windows", version: "7.1.0" } };
await page.evaluate(
  ([p, i, a]) =>
    window.connectElgatoStreamDeckSocket(p, "pi-uuid", "registerPropertyInspector", i, a),
  [String(port), JSON.stringify(info), JSON.stringify(actionInfo)],
);
await page.waitForTimeout(800);

const sent = (event, pred = () => true) => received.some((m) => m.event === event && pred(m));
check(sent("registerPropertyInspector"), "registerPropertyInspector gesendet");
check(sent("getGlobalSettings"), "getGlobalSettings angefragt");
check(
  sent("sendToPlugin", (m) => m.payload?.event === "getStatus"),
  "sendToPlugin {event:getStatus}",
);
check(
  sent("sendToPlugin", (m) => m.payload?.event === "repos"),
  "sendToPlugin {event:repos} (datasource)",
);
const statusText = await page.locator("#status").textContent();
check(/verbunden · 7 Sessions/.test(statusText), `Statuszeile: "${statusText.trim()}"`);
check(
  (await page.locator("#position").evaluate((e) => e.disabled)) === false &&
    (await page.locator("#repo").evaluate((e) => e.disabled)) === true,
  "Automatisch: Position aktiv, Repo gesperrt",
);

await page.screenshot({ path: screenshot, fullPage: true });
console.log(`Screenshot: ${screenshot}`);

// Hub-URL ändern -> setGlobalSettings mit allen bekannten Schlüsseln
await page.locator("sdpi-textfield[setting=hubUrl] input").fill("http://10.0.0.1:8788");
await page.waitForTimeout(600);
check(
  sent(
    "setGlobalSettings",
    (m) => m.payload?.hubUrl === "http://10.0.0.1:8788" && m.payload?.token === "geheim",
  ),
  "setGlobalSettings {hubUrl, token, …}",
);

// Belegung „Fest“ -> setSettings, Repo aktiv
await page.locator("#mode .checkable-text", { hasText: "Fest" }).click();
await page.waitForTimeout(300);
check(
  sent("setSettings", (m) => m.payload?.mode === "fixed" && m.payload?.position === "3"),
  "setSettings {mode:fixed}",
);
check(
  (await page.locator("#position").evaluate((e) => e.disabled)) === true &&
    (await page.locator("#repo").evaluate((e) => e.disabled)) === false,
  "Fest: Position gesperrt, Repo aktiv",
);
await page.locator("#repo select").selectOption("florianwilde/homelab");
await page.waitForTimeout(300);
check(
  sent("setSettings", (m) => m.payload?.repo === "florianwilde/homelab"),
  "setSettings {repo}",
);

// Buttons
await page.locator("#test-connection").click();
await page.waitForTimeout(300);
check(
  sent("sendToPlugin", (m) => m.payload?.event === "testConnection"),
  "sendToPlugin {event:testConnection}",
);
check(
  (await page.locator("#test-result").innerText()) === "Hub erreichbar",
  "Testergebnis angezeigt",
);
await page.locator("#copy-snippet").click();
await page.waitForTimeout(300);
check((await page.locator("#copy-result").innerText()) === "kopiert", "Snippet kopiert");
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
check(clip.startsWith("Klone `https://github.com/florianwilde/agent-deck`"), "Zwischenablage");

check(errors.length === 0, `keine JS-Fehler ${errors.length ? JSON.stringify(errors) : ""}`);
check(
  received.every((m) => m.event === "registerPropertyInspector" || m.context === "pi-uuid"),
  "alle Nachrichten mit context = PI-UUID",
);

await browser.close();
wss.close();
console.log(failures.length ? `${failures.length} Fehler` : "alles ok");
process.exit(failures.length ? 1 : 0);
