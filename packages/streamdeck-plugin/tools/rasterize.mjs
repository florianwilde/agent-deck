// Rendert das Plugin-Icon (muss laut Manifest-Schema PNG sein) aus tools/marketplace.svg (von tools/icons.ts):
//   NODE_PATH=$(npm root -g) node tools/rasterize.mjs
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "de.wildeflorian.agentdeck.sdPlugin",
  "imgs",
  "plugin",
);
const svg = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), "marketplace.svg"),
  "utf8",
);

const browser = await chromium.launch();
for (const [size, name] of [
  [256, "marketplace.png"],
  [512, "marketplace@2x.png"],
]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`,
  );
  await page.screenshot({ path: join(dir, name), omitBackground: true });
  await page.close();
}
await browser.close();
