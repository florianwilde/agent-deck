// Erzeugt tools/preview.html: alle Tastenbilder aus src/render/, aufgebaut wie
// docs/design/mockups.html (Screenshots 01 und 03). Aufruf aus dem Repo-Root:
//   node --conditions=source --experimental-strip-types packages/streamdeck-plugin/tools/preview.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { commandKey, emptyKey, overviewKey, projectKey, TOKENS } from "../src/render/index.ts";

const accent = { accent: TOKENS.macroAccent };
const queueAccent = { count: 2, accent: TOKENS.status.done.fill };

const key = (svg: string) => `<div class="key">${svg}</div>`;
const cell = (svg: string, cap: string, sub = "") =>
  `<div class="cell">${key(svg)}<div class="cap">${cap}${sub ? `<small>${sub}</small>` : ""}</div></div>`;

const states = [
  cell(
    projectKey("needs_input", { name: "wartungsplaner", since: "4m", count: 1 }),
    "Braucht Antwort",
    "Phase A",
  ),
  cell(
    projectKey("needs_input", { name: "wartungsplaner", since: "4m", count: 1, blinkPhase: 1 }),
    "Braucht Antwort",
    "Phase B (Blinken)",
  ),
  cell(
    projectKey("done", { name: "proxdeploy", since: "12m", queue: 0 }),
    "Fertig",
    "wartet auf Prompt",
  ),
  cell(projectKey("error", { name: "laufzettel", since: "1m" }), "Fehler", "StopFailure"),
  cell(
    projectKey("working", { name: "sshkv", since: "2m", queue: 2, dot: 1 }),
    "Arbeitet",
    "+2 in der Queue",
  ),
  cell(projectKey("idle", { name: "wachbuch", since: "3h" }), "Inaktiv", "30 Min. kein Event"),
  cell(
    projectKey("offline", { name: "agent-deck", since: "–" }),
    "Hub offline",
    "keine Verbindung",
  ),
];

const extras = [
  cell(emptyKey(), "Freier Slot", "keine Session"),
  cell(
    projectKey("done", { name: "proxdeploy", since: "1m", count: 2, queue: 1, pinned: true }),
    "Fertig",
    "2 Sessions, fest, +1",
  ),
  cell(
    projectKey("working", { name: "sshkv", since: "2m", tool: "CC", pinned: true }),
    "Arbeitet",
    "Tool-Badge CC, fest",
  ),
  cell(overviewKey({ needsInput: 0, done: 0 }), "Ampel", "alles ruhig"),
  cell(
    commandKey("macro", "Review", "keine Session", { warn: true }),
    "Prompt-Makro",
    "Ziel nicht gefunden",
  ),
  cell(commandKey("queue", "Queue", "leer", { count: 0 }), "Queue", "leer"),
];

const deck = [
  overviewKey({ needsInput: 1, done: 2 }),
  projectKey("needs_input", { name: "wartungsplaner", since: "4m" }),
  projectKey("done", { name: "proxdeploy", since: "12m" }),
  projectKey("done", { name: "proxledger", since: "25m", queue: 1 }),
  projectKey("error", { name: "laufzettel", since: "1m" }),
  projectKey("working", { name: "sshkv", since: "2m", queue: 2, dot: 1 }),
  projectKey("working", { name: "bms-restplatz", since: "6m", dot: 0 }),
  projectKey("working", { name: "homeassistant-dash", since: "9m", dot: 2 }),
  projectKey("idle", { name: "wachbuch", since: "3h" }),
  projectKey("idle", { name: "lego-tracker", since: "1d" }),
  commandKey("macro", "Tests", "→ zuletzt aktiv", accent),
  commandKey("macro", "Weiter", "→ zuletzt aktiv", accent),
  commandKey("macro", "Commit+PR", "→ zuletzt aktiv", accent),
  commandKey("queue", "Queue", "„Tests laufen…“", queueAccent),
  commandKey("page", "Seite 1/2", "12 Sessions", {}),
];

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>agent-deck Renderer-Vorschau</title>
<style>
  :root { --bg:#0B0D10; --text:#F2F4F7; --dim:#8A93A1; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family: Inter, 'Segoe UI', Arial, sans-serif; }
  section { padding:40px 48px; width:fit-content; }
  h2 { margin:0 0 6px; font-size:22px; font-weight:700; letter-spacing:-.2px; }
  p.sub { margin:0 0 28px; color:var(--dim); font-size:14px; max-width:820px; line-height:1.45; }
  .grid { display:grid; gap:28px 22px; grid-template-columns:repeat(7,150px); }
  .cell { display:flex; flex-direction:column; align-items:center; gap:10px; width:150px; }
  .key { width:144px; height:144px; border-radius:18px; overflow:hidden; box-shadow:0 0 0 1px #000, 0 6px 14px rgba(0,0,0,.55); }
  .key svg { display:block; }
  .cap { font-size:12.5px; font-weight:600; text-align:center; line-height:1.35; }
  .cap small { display:block; font-weight:500; color:var(--dim); font-size:11.5px; }
  .device { background:linear-gradient(#24282F,#1A1D22); border-radius:34px; padding:34px 40px 40px; box-shadow:inset 0 1px 0 #3a3f48, 0 20px 40px rgba(0,0,0,.6); width:fit-content; }
  .device .keys { display:grid; grid-template-columns:repeat(5,144px); gap:22px; }
  .device .logo { margin-top:22px; text-align:center; color:#5b6470; font-size:12px; letter-spacing:3px; font-weight:700; }
</style>
</head>
<body>
<section id="states">
  <h2>Projekt-Slot · Zustände</h2>
  <p class="sub">Erzeugt mit packages/streamdeck-plugin/src/render (TypeScript-Port von docs/design/keys.js).</p>
  <div class="grid">${states.join("")}</div>
</section>
<section id="extras">
  <h2>Weitere Fälle</h2>
  <p class="sub">Freier Slot (neu, nicht in keys.js), Sitzungszähler, Pin, Tool-Badge, ruhige Ampel, Warnzustand.</p>
  <div class="grid">${extras.join("")}</div>
</section>
<section id="deck">
  <h2>Beispiel-Belegung · Stream Deck MK.2 (15 Tasten)</h2>
  <p class="sub">Obere linke Ecke = Ampel. Danach füllen sich die Slots automatisch nach Dringlichkeit. Unterste Reihe: Makros, Queue, Blättern.</p>
  <div class="device"><div class="keys">${deck.map(key).join("")}</div><div class="logo">STREAM DECK</div></div>
</section>
</body>
</html>
`;

const out = fileURLToPath(new URL("preview.html", import.meta.url));
// Prettier-formatiert, damit `prettier --check` im Repo grün bleibt.
const config = (await resolveConfig(out)) ?? {};
writeFileSync(out, await format(html, { ...config, filepath: out }));
console.log(`geschrieben: ${out}`);
