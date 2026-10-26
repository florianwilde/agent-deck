import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/data/**",
      "docs/design/**",
      "**/*.sdPlugin/bin/**",
      "**/*.sdPlugin/ui/vendor/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { process: "readonly", console: "readonly" },
    },
  },
  {
    // Property Inspector (Browser) und Werkzeuge, die Node und Playwright-Seiten mischen.
    files: ["**/*.sdPlugin/ui/**/*.js", "packages/streamdeck-plugin/tools/**/*.mjs"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly",
      },
    },
  },
);
