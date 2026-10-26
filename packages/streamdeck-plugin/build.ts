// Bündelt src/plugin.ts samt Abhängigkeiten nach <uuid>.sdPlugin/bin/plugin.js.
// esbuild statt der Rollup-Vorlage von `streamdeck create`: versteht die `.ts`-Importe
// und die Export-Bedingung `source` der Workspace-Pakete ohne weitere Plugins.
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

const outdir = "de.wildeflorian.agentdeck.sdPlugin/bin";

await build({
  entryPoints: ["src/plugin.ts"],
  outfile: `${outdir}/plugin.js`,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  conditions: ["source", "node"],
  // ws lädt optionale native Module dynamisch; die braucht es nicht.
  external: ["bufferutil", "utf-8-validate"],
  banner: {
    // CommonJS-Abhängigkeiten im ESM-Bundle brauchen `require`.
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  minify: true,
  legalComments: "eof",
  logLevel: "info",
});

await writeFile(`${outdir}/package.json`, `{ "type": "module" }\n`);
