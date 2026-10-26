import type { Status } from "@agent-deck/shared";
import { TOKENS, type Tool } from "./tokens.ts";

// Tastenbilder (144 × 144 px, @2x) als SVG-Strings. 1:1-Port von
// docs/design/keys.js: Geometrie, Farben, Texte und sogar der Leerraum in den
// Template-Strings sind identisch, die Tests vergleichen byte-genau.

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** Escapt & < > " für Text und Attribute im SVG. */
export const esc = (s: unknown): string => String(s).replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);

/**
 * Projektnamen in 1–2 Zeilen setzen. Bis `max` Zeichen pro Zeile; die Schrift
 * schrumpft dafür von 20 px auf bis zu 15 px (siehe nameFontSize).
 * Umbruch bevorzugt an - _ . oder Leerzeichen, Rest wird mit … gekürzt.
 */
export function wrapName(name: string, max = 15): string[] {
  if (name.length <= max) return [name];
  const parts = name.split(/(?<=[-_. ])/);
  let first = "";
  while (parts.length > 0 && (first + (parts[0] ?? "")).length <= max) first += parts.shift() ?? "";
  if (!first) {
    first = name.slice(0, max);
    parts.splice(0, parts.length, name.slice(max));
  }
  let second = parts.join("");
  if (second.length > max) second = second.slice(0, max - 1) + "…";
  return [first.replace(/[-_. ]$/, ""), second];
}

/** Schriftgröße für den Projektnamen: 20 px, bei langen Zeilen bis 15 px. */
export function nameFontSize(lines: readonly string[]): number {
  const longest = Math.max(...lines.map((l) => l.length));
  return Math.max(15, Math.min(20, Math.floor((20 * 11) / longest)));
}

function badge(tool: Tool, x: number, y: number, onColor: boolean): string {
  const c = onColor ? "rgba(0,0,0,.28)" : TOKENS.tool[tool];
  const ink = onColor ? "#FFFFFF" : "#14171C";
  return `<rect x="${x}" y="${y}" width="30" height="18" rx="5" fill="${c}"/>
  <text x="${x + 15}" y="${y + 13}" text-anchor="middle" font-size="11" font-weight="700" fill="${ink}">${tool}</text>`;
}

// Kleines Wolken-Symbol = Cloud-Session
function cloudIcon(x: number, y: number, c: string): string {
  return `<path d="M${x + 7} ${y + 16}h16a5 5 0 0 0 0-10a7 7 0 0 0-13-1a5 5 0 0 0-3 11z" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>`;
}

export interface ProjectKeyOptions {
  /** Anzeigename (Repo-Name). */
  name: string;
  /** Tool-Badge; ohne = Wolken-Symbol (Cloud-Session). */
  tool?: Tool;
  /**
   * Zeit seit Statuswechsel, fertig formatiert (z. B. aus formatSince).
   * Für `offline` setzt der Aufrufer selbst "–".
   */
  since: string;
  /** Einträge in der Prompt-Queue; ohne/0 = kein Zähler. */
  queue?: number;
  /** Anzahl Sessions im Slot; > 1 zeigt „n×“. */
  count?: number;
  /** Blinkphase bei `needs_input` (1 = dunkleres Rot). */
  blinkPhase?: 0 | 1;
  /** Heller Fortschrittspunkt bei `working` (Standard 0). */
  dot?: 0 | 1 | 2;
  /** Fest belegter Slot: kleiner Punkt oben rechts. */
  pinned?: boolean;
}

/** Projekt-Slot. `needs_input` entspricht `approval` in keys.js. */
export function projectKey(state: Status, o: ProjectKeyOptions): string {
  const s = TOKENS.status[state];
  const queue = o.queue ?? 0; // wie keys.js: undefined > 0 ist false
  const count = o.count ?? 0; // wie keys.js: undefined > 1 ist false
  const loud = state === "needs_input" || state === "done" || state === "error";
  const dimPhase = state === "needs_input" && o.blinkPhase === 1; // Blinken: 2. Phase dunkler
  const fill = dimPhase ? TOKENS.blinkFill : s.fill;
  const ink = loud ? s.ink : TOKENS.text;
  const lines = wrapName(o.name);
  const fs = nameFontSize(lines);
  const nameY = lines.length === 1 ? 74 : 64;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" font-family="${TOKENS.font}">
  <rect width="144" height="144" fill="${TOKENS.bg}"/>`;
  if (loud) {
    out += `<rect x="0" y="0" width="144" height="144" fill="${fill}"/>`;
  } else {
    out += `<defs><clipPath id="k"><rect x="6" y="6" width="132" height="132" rx="14"/></clipPath></defs>
    <g clip-path="url(#k)"><rect x="6" y="6" width="132" height="132" fill="${TOKENS.bgRaised}"/>
    <rect x="6" y="114" width="132" height="24" fill="${s.fill}" opacity="${state === "offline" ? 0.5 : 1}"/></g>`;
  }
  // Kopfzeile: Tool-Badge links, Sitzungszahl / Pin rechts
  if (o.tool) out += badge(o.tool, 12, 12, loud);
  else out += cloudIcon(12, 12, loud ? ink : TOKENS.textDim);
  if (count > 1)
    out += `<text x="132" y="25" text-anchor="end" font-size="13" font-weight="700" fill="${ink}">${o.count}×</text>`;
  if (o.pinned)
    out += `<circle cx="${count > 1 ? 108 : 128}" cy="21" r="4" fill="${ink}" opacity=".85"/>`;
  // Projektname
  lines.forEach((l, i) => {
    out += `<text x="72" y="${nameY + i * (fs + 3)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${ink}" opacity="${state === "idle" || state === "offline" ? 0.7 : 1}">${esc(l)}</text>`;
  });
  // Fußzeile
  if (loud) {
    out += `<rect x="12" y="110" width="120" height="22" rx="11" fill="rgba(0,0,0,.22)"/>
    <text x="72" y="125" text-anchor="middle" font-size="12" font-weight="700" letter-spacing=".6" fill="${s.ink === "#1A1300" ? "#1A1300" : "#FFFFFF"}">${s.label} · ${esc(o.since)}</text>`;
  } else {
    out += `<text x="72" y="131" text-anchor="middle" font-size="12" font-weight="700" letter-spacing=".6" fill="${s.ink}">${s.label} · ${esc(o.since)}</text>`;
  }
  if (state === "working") {
    // Fortschrittspunkte (Animation: der helle Punkt wandert alle 500 ms)
    [0, 1, 2].forEach((i) => {
      out += `<circle cx="${60 + i * 12}" cy="100" r="3.5" fill="${s.fill}" opacity="${i === (o.dot ?? 0) ? 1 : 0.35}"/>`;
    });
  }
  if (queue > 0) {
    // Queue-Zähler oben rechts (neben einem evtl. Sitzungszähler)
    const qx = count > 1 ? 70 : 102;
    out += `<rect x="${qx}" y="12" width="30" height="18" rx="9" fill="${loud ? "rgba(0,0,0,.28)" : "#F5B83D"}"/>
    <text x="${qx + 15}" y="25" text-anchor="middle" font-size="11" font-weight="800" fill="${loud ? "#FFFFFF" : "#1A1300"}">+${o.queue}</text>`;
  }
  return out + `</svg>`;
}

export interface OverviewCounts {
  /** Projekte mit `needs_input` (rot); in keys.js `approval`. */
  needsInput: number;
  /** Projekte mit `done` (gelb). */
  done: number;
}

/** Ampel: Summe aller roten + gelben Projekte. */
export function overviewKey({ needsInput, done }: OverviewCounts): string {
  const red = TOKENS.status.needs_input;
  const fill = needsInput > 0 ? red.fill : done > 0 ? TOKENS.status.done.fill : TOKENS.bgRaised;
  const ink = needsInput > 0 ? "#FFFFFF" : done > 0 ? "#1A1300" : TOKENS.textDim;
  const n = needsInput + done;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" font-family="${TOKENS.font}">
  <rect width="144" height="144" fill="${TOKENS.bg}"/>
  <rect width="144" height="144" fill="${fill}"/>
  <text x="72" y="30" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="1" fill="${ink}" opacity=".85">WARTET</text>
  <text x="72" y="92" text-anchor="middle" font-size="58" font-weight="800" fill="${ink}">${n}</text>
  <text x="72" y="126" text-anchor="middle" font-size="12" font-weight="600" fill="${ink}" opacity=".9">${needsInput} rot · ${done} gelb</text>
  </svg>`;
}

export type CommandKind = "macro" | "queue" | "page";

const ICONS: Record<CommandKind, string> = {
  macro: `<path d="M76 34L56 62h16l-4 22 20-30H72z" fill="currentColor"/>`,
  queue: `<rect x="48" y="38" width="48" height="10" rx="4" fill="currentColor"/><rect x="48" y="54" width="48" height="10" rx="4" fill="currentColor" opacity=".6"/><rect x="48" y="70" width="48" height="10" rx="4" fill="currentColor" opacity=".35"/>`,
  page: `<path d="M62 40l20 18-20 18" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
};

export interface CommandKeyOptions {
  /** Symbolfarbe, z. B. TOKENS.macroAccent; Standard TOKENS.text. */
  accent?: string;
  /** Zähler oben rechts (gelb, wenn > 0); ohne = kein Zähler. */
  count?: number;
  /** Warnzustand, z. B. Ziel-Session nicht gefunden. */
  warn?: boolean;
}

/** Makro / Queue / Blättern. */
export function commandKey(
  kind: CommandKind,
  label: string,
  sub: string,
  o: CommandKeyOptions = {},
): string {
  const warn = o.warn; // z. B. Ziel-Session nicht gefunden → Warnzustand
  const color = warn ? TOKENS.status.error.fill : o.accent || TOKENS.text;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" font-family="${TOKENS.font}">
  <rect width="144" height="144" fill="${TOKENS.bg}"/>
  <rect x="6" y="6" width="132" height="132" rx="14" fill="${TOKENS.bgRaised}"/>
  <g style="color:${color}" color="${color}">${ICONS[kind]}</g>
  <text x="72" y="104" text-anchor="middle" font-size="16" font-weight="700" fill="${TOKENS.text}">${esc(label)}</text>
  <text x="72" y="124" text-anchor="middle" font-size="11.5" font-weight="600" fill="${warn ? TOKENS.status.error.fill : TOKENS.textDim}">${esc(sub)}</text>`;
  if (o.count !== undefined) {
    out += `<rect x="100" y="14" width="30" height="20" rx="10" fill="${o.count > 0 ? TOKENS.status.done.fill : "#2C333D"}"/>
    <text x="115" y="28" text-anchor="middle" font-size="12" font-weight="800" fill="${o.count > 0 ? "#1A1300" : TOKENS.textDim}">${o.count}</text>`;
  }
  if (warn)
    out += `<path d="M112 14l14 24h-28z" fill="${TOKENS.status.error.fill}"/><text x="112" y="34" text-anchor="middle" font-size="13" font-weight="800" fill="#FFFFFF">!</text>`;
  return out + `</svg>`;
}

/**
 * Freier Slot (keys.js hat keinen): nur die ruhige Innenfläche wie bei
 * commandKey, ohne Symbol und Text.
 */
export function emptyKey(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" fill="${TOKENS.bg}"/>
  <rect x="6" y="6" width="132" height="132" rx="14" fill="${TOKENS.bgRaised}"/>
  </svg>`;
}

/** SVG als Data-URL für `setImage` (DESIGN.md). */
export function svgToDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf8," + encodeURIComponent(svg);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Zeit seit `sinceIso` als „4m“, „2h“, „1d“ (abgerundet; unter einer Minute
 * und in der Zukunft „0m“). Ungültige Zeitstempel ergeben „–“. Für `offline`
 * übergibt der Aufrufer selbst „–“ als `since`, statt diese Funktion zu nutzen.
 */
export function formatSince(sinceIso: string, now: number): string {
  const t = Date.parse(sinceIso);
  if (Number.isNaN(t)) return "–";
  const ms = Math.max(0, now - t);
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}
