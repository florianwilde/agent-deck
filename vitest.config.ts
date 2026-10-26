import { defineConfig } from "vitest/config";

export default defineConfig({
  // Workspace-Pakete direkt aus src/ laden (Export-Bedingung "source"), ohne vorherigen Build.
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
