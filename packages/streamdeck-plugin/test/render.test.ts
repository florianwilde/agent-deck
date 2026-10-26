import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { STATUS_COLORS, STATUSES, type Status } from "@agent-deck/shared";
import { describe, expect, it } from "vitest";
import {
  commandKey,
  emptyKey,
  esc,
  formatSince,
  nameFontSize,
  overviewKey,
  projectKey,
  svgToDataUrl,
  TOKENS,
  wrapName,
  type CommandKeyOptions,
  type CommandKind,
  type ProjectKeyOptions,
} from "../src/render/index.ts";

// ---------------------------------------------------------------------------
// Referenz-Renderer docs/design/keys.js unverändert laden (vm, mit `module`).
// ---------------------------------------------------------------------------

interface Reference {
  TOKENS: { status: Record<string, { fill: string; ink: string; label: string }> };
  projectKey: (state: string, o: object) => string;
  overviewKey: (o: { approval: number; done: number }) => string;
  commandKey: (kind: string, label: string, sub: string, o?: object) => string;
  wrapName: (name: string, max?: number) => string[];
  nameFontSize: (lines: string[]) => number;
}

const keysJs = fileURLToPath(new URL("../../../docs/design/keys.js", import.meta.url));
const sandbox = { module: { exports: {} as unknown } };
runInNewContext(readFileSync(keysJs, "utf8"), sandbox, { filename: keysJs });
const ref = sandbox.module.exports as Reference;

/** Status aus @agent-deck/shared → Zustandsname in keys.js. */
const refState = (s: Status): string => (s === "needs_input" ? "approval" : s);

// ---------------------------------------------------------------------------
// Fälle: Screenshot 01, Screenshot 03 und Randfälle
// ---------------------------------------------------------------------------

const projectCases: [string, Status, ProjectKeyOptions][] = [
  // Screenshot 01 (Zustände, wie in mockups.html)
  ["01 Antwort Phase A", "needs_input", { name: "wartungsplaner", since: "4m", count: 1 }],
  [
    "01 Antwort Phase B",
    "needs_input",
    { name: "wartungsplaner", since: "4m", count: 1, blinkPhase: 1 },
  ],
  ["01 Fertig", "done", { name: "proxdeploy", since: "12m", queue: 0 }],
  ["01 Fehler", "error", { name: "laufzettel", since: "1m" }],
  ["01 Arbeitet", "working", { name: "sshkv", since: "2m", queue: 2, dot: 1 }],
  ["01 Inaktiv", "idle", { name: "wachbuch", since: "3h" }],
  ["01 Offline", "offline", { name: "agent-deck", since: "–" }],
  // Screenshot 03 (Beispiel-Belegung MK.2)
  ["03 wartungsplaner", "needs_input", { name: "wartungsplaner", since: "4m" }],
  ["03 proxdeploy", "done", { name: "proxdeploy", since: "12m" }],
  ["03 proxledger", "done", { name: "proxledger", since: "25m", queue: 1 }],
  ["03 laufzettel", "error", { name: "laufzettel", since: "1m" }],
  ["03 sshkv", "working", { name: "sshkv", since: "2m", queue: 2, dot: 1 }],
  ["03 bms-restplatz", "working", { name: "bms-restplatz", since: "6m", dot: 0 }],
  ["03 homeassistant-dash", "working", { name: "homeassistant-dash", since: "9m", dot: 2 }],
  ["03 wachbuch", "idle", { name: "wachbuch", since: "3h" }],
  ["03 lego-tracker", "idle", { name: "lego-tracker", since: "1d" }],
  // Lange Namen
  ["lang >30", "working", { name: "ein-sehr-langer-repository-name-xyz", since: "5m" }],
  ["lang ohne Trenner", "done", { name: "abcdefghijklmnopqrstuvwxyz0123456789", since: "1h" }],
  ["lang mit Leerzeichen", "idle", { name: "mein projekt mit namen", since: "2d" }],
  ["lang unterstrich", "error", { name: "very_long_snake_case_name", since: "7m" }],
  ["genau 15", "working", { name: "abcdefghijklmno", since: "0m", dot: 2 }],
  ["16 Zeichen", "working", { name: "abcdefghijklmnop", since: "0m" }],
  // Escaping
  ["Sonderzeichen", "done", { name: 'a&b<c>"d"', since: "<1m>" }],
  ["Sonderzeichen lang", "needs_input", { name: 'tom&jerry-<script>"x"', since: "&" }],
  // Zähler, Queue, Pin, Tool-Badges
  ["count 2 laut", "needs_input", { name: "wartungsplaner", since: "4m", count: 2 }],
  ["count 3 queue 4 laut", "done", { name: "proxdeploy", since: "1m", count: 3, queue: 4 }],
  ["count 2 queue 1 ruhig", "working", { name: "sshkv", since: "2m", count: 2, queue: 1 }],
  ["count 2 pinned", "idle", { name: "wachbuch", since: "3h", count: 2, pinned: true }],
  [
    "count 2 queue 2 pinned",
    "error",
    { name: "laufzettel", since: "1m", count: 2, queue: 2, pinned: true },
  ],
  ["pinned", "done", { name: "proxdeploy", since: "12m", pinned: true }],
  ["pinned offline", "offline", { name: "agent-deck", since: "–", pinned: true }],
  ["pinned false", "working", { name: "sshkv", since: "2m", pinned: false }],
  ["Tool CC laut", "needs_input", { name: "wartungsplaner", since: "4m", tool: "CC" }],
  ["Tool CX ruhig", "working", { name: "sshkv", since: "2m", tool: "CX", queue: 3 }],
  ["Blinkphase 0 explizit", "needs_input", { name: "x", since: "1m", blinkPhase: 0 }],
  ["Blinkphase 1 bei done", "done", { name: "x", since: "1m", blinkPhase: 1 }],
  ["leerer Name", "idle", { name: "", since: "1m" }],
];

// Alle Status × ein paar Optionskombinationen zusätzlich
for (const s of STATUSES) {
  projectCases.push(
    [`alle: ${s} minimal`, s, { name: "proxledger", since: "9m" }],
    [
      `alle: ${s} voll`,
      s,
      { name: "bms-restplatz", since: "2h", queue: 5, count: 4, pinned: true },
    ],
  );
}

const overviewCases: [number, number][] = [
  [1, 2],
  [0, 2],
  [0, 0],
  [3, 0],
  [12, 7],
];

const commandCases: [string, CommandKind, string, string, CommandKeyOptions | undefined][] = [
  ["03 Tests", "macro", "Tests", "→ zuletzt aktiv", { accent: "#8E8CF5" }],
  ["03 Weiter", "macro", "Weiter", "→ zuletzt aktiv", { accent: "#8E8CF5" }],
  ["03 Commit+PR", "macro", "Commit+PR", "→ zuletzt aktiv", { accent: "#8E8CF5" }],
  ["03 Queue", "queue", "Queue", "„Tests laufen…“", { count: 2, accent: "#F5B83D" }],
  ["03 Seite", "page", "Seite 1/2", "12 Sessions", {}],
  ["02 Makro sshkv", "macro", "Tests", "→ sshkv", { accent: "#8E8CF5" }],
  ["02 Makro warn", "macro", "Review", "keine Session", { warn: true }],
  ["Queue leer", "queue", "Queue", "leer", { count: 0 }],
  ["Queue warn + count", "queue", "Queue", "x", { count: 1, warn: true, accent: "#8E8CF5" }],
  ["Seite ohne opts", "page", "Seite 2/2", "8 Sessions", undefined],
  ["Escaping", "macro", 'A&B <"x">', "→ <repo>&", { accent: "#8E8CF5" }],
  ["warn false", "page", "Seite 1/1", "3 Sessions", { warn: false }],
];

// ---------------------------------------------------------------------------

describe("Byte-Gleichheit mit docs/design/keys.js", () => {
  it.each(projectCases)("projectKey: %s", (_, state, opts) => {
    expect(projectKey(state, opts)).toBe(ref.projectKey(refState(state), opts));
  });

  it.each(overviewCases)("overviewKey: %i rot, %i gelb", (needsInput, done) => {
    expect(overviewKey({ needsInput, done })).toBe(ref.overviewKey({ approval: needsInput, done }));
  });

  it.each(commandCases)("commandKey: %s", (_, kind, label, sub, opts) => {
    expect(commandKey(kind, label, sub, opts)).toBe(ref.commandKey(kind, label, sub, opts));
  });

  it("wrapName und nameFontSize liefern dasselbe wie keys.js", () => {
    const names = [
      "sshkv",
      "wartungsplaner",
      "homeassistant-dash",
      "bms-restplatz",
      "abcdefghijklmno",
      "abcdefghijklmnop",
      "ein-sehr-langer-repository-name-xyz",
      "abcdefghijklmnopqrstuvwxyz0123456789",
      "mein projekt mit namen",
      "a.b.c.d.e.f.g.h.i.j.k.l.m",
      "-----------------",
      "",
    ];
    for (const n of names) {
      expect(wrapName(n)).toEqual([...ref.wrapName(n)]);
      expect(wrapName(n, 8)).toEqual([...ref.wrapName(n, 8)]);
      expect(nameFontSize(wrapName(n))).toBe(ref.nameFontSize(ref.wrapName(n)));
    }
  });
});

describe("Tokens", () => {
  it("Statusfarben stammen aus STATUS_COLORS und stimmen mit keys.js überein", () => {
    for (const s of STATUSES) {
      expect(TOKENS.status[s].fill).toBe(STATUS_COLORS[s]);
      const r = ref.TOKENS.status[refState(s)];
      expect(r).toBeDefined();
      expect(TOKENS.status[s]).toEqual({ fill: r?.fill, ink: r?.ink, label: r?.label });
    }
  });
});

describe("wrapName", () => {
  it("lässt kurze Namen einzeilig", () => {
    expect(wrapName("sshkv")).toEqual(["sshkv"]);
    expect(wrapName("abcdefghijklmno")).toEqual(["abcdefghijklmno"]);
  });

  it("bricht an Trennzeichen um und entfernt das Trennzeichen am Zeilenende", () => {
    expect(wrapName("homeassistant-dash")).toEqual(["homeassistant", "dash"]);
    expect(wrapName("mein projekt mit namen")).toEqual(["mein projekt", "mit namen"]);
  });

  it("schneidet ohne Trenner hart und kürzt die zweite Zeile mit …", () => {
    expect(wrapName("abcdefghijklmnopqrstuvwxyz0123456789")).toEqual([
      "abcdefghijklmno",
      "pqrstuvwxyz012…",
    ]);
  });
});

describe("nameFontSize", () => {
  it("20 px bis 11 Zeichen, dann kleiner, nie unter 15 px", () => {
    expect(nameFontSize(["sshkv"])).toBe(20);
    expect(nameFontSize(["abcdefghijk"])).toBe(20);
    expect(nameFontSize(["wartungsplaner"])).toBe(15);
    expect(nameFontSize(["abcdefghijkl"])).toBe(18);
    expect(nameFontSize(["abcdefghijklmno", "x"])).toBe(15);
  });
});

describe("esc", () => {
  it("escapt & < > und Anführungszeichen", () => {
    expect(esc(`a&b<c>"d"'e'`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;'e'");
  });
});

describe("emptyKey", () => {
  it("zeigt nur Grund und ruhige Innenfläche", () => {
    const svg = emptyKey();
    expect(svg).toContain(`<rect width="144" height="144" fill="${TOKENS.bg}"/>`);
    expect(svg).toContain(
      `<rect x="6" y="6" width="132" height="132" rx="14" fill="${TOKENS.bgRaised}"/>`,
    );
    expect(svg).not.toContain("<text");
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});

describe("svgToDataUrl", () => {
  it("kodiert das SVG als Data-URL", () => {
    const svg = `<svg a="b"># ü</svg>`;
    const url = svgToDataUrl(svg);
    expect(url).toBe("data:image/svg+xml;charset=utf8," + encodeURIComponent(svg));
    expect(url).toBe(
      "data:image/svg+xml;charset=utf8,%3Csvg%20a%3D%22b%22%3E%23%20%C3%BC%3C%2Fsvg%3E",
    );
    expect(decodeURIComponent(url.slice(url.indexOf(",") + 1))).toBe(svg);
  });
});

describe("formatSince", () => {
  const base = Date.parse("2026-10-26T12:00:00Z");
  const iso = (msBefore: number) => new Date(base - msBefore).toISOString();
  const M = 60_000;

  it("Minuten, Stunden, Tage, abgerundet", () => {
    expect(formatSince(iso(0), base)).toBe("0m");
    expect(formatSince(iso(59_999), base)).toBe("0m");
    expect(formatSince(iso(M), base)).toBe("1m");
    expect(formatSince(iso(4 * M + 59_000), base)).toBe("4m");
    expect(formatSince(iso(59 * M), base)).toBe("59m");
    expect(formatSince(iso(60 * M), base)).toBe("1h");
    expect(formatSince(iso(2 * 60 * M + 59 * M), base)).toBe("2h");
    expect(formatSince(iso(23 * 60 * M + 59 * M), base)).toBe("23h");
    expect(formatSince(iso(24 * 60 * M), base)).toBe("1d");
    expect(formatSince(iso(10 * 24 * 60 * M + 5 * M), base)).toBe("10d");
  });

  it("Zukunft ergibt 0m, ungültig ergibt –", () => {
    expect(formatSince(iso(-5 * M), base)).toBe("0m");
    expect(formatSince("kein datum", base)).toBe("–");
  });
});
