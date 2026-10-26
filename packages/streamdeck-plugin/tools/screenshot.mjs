// Rendert tools/preview.html mit Playwright (Chromium) nach tools/preview.png.
// Aufruf: node packages/streamdeck-plugin/tools/screenshot.mjs
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

// Playwright ist in der Cloud-Umgebung global installiert, nicht im Workspace.
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const html = fileURLToPath(new URL("preview.html", import.meta.url));
const png = fileURLToPath(new URL("preview.png", import.meta.url));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  await page.goto(pathToFileURL(html).href);
  await page.screenshot({ path: png, fullPage: true });
  console.log(`geschrieben: ${png}`);
} finally {
  await browser.close();
}
