// Erzeugt die Manifest-Bilder als SVG aus dem Renderer (einmalig bzw. nach Design-Änderungen):
//   node --conditions=source --experimental-strip-types tools/icons.ts
import { writeFile } from "node:fs/promises";
import { projectKey } from "../src/render/index.ts";

const imgs = "de.wildeflorian.agentdeck.sdPlugin/imgs";

// Wolken-Symbol aus keys.js (cloudIcon), auf 20 × 20 skaliert, weiß wie die Stream-Deck-Aktionsliste es erwartet.
const cloud = (size: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="5 2 26 18">` +
  `<path d="M7 16h16a5 5 0 0 0 0-10a7 7 0 0 0-13-1a5 5 0 0 0-3 11z" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linejoin="round"/></svg>\n`;

await writeFile(`${imgs}/actions/slot/icon.svg`, cloud(20));
await writeFile(`${imgs}/plugin/category-icon.svg`, cloud(28));
// Standardbild der Taste, bis das Plugin zeichnet.
await writeFile(
  `${imgs}/actions/slot/key.svg`,
  projectKey("offline", { name: "agent-deck", since: "–" }) + "\n",
);
// Plugin-Icon (Marketplace/Store-Liste): die rote Antwort-Taste; danach tools/rasterize.mjs (PNG Pflicht).
await writeFile(
  "tools/marketplace.svg",
  projectKey("needs_input", { name: "agent-deck", since: "4m" }) + "\n",
);
