import { STATUS_COLORS, type Status } from "@agent-deck/shared";

// Design-Tokens der Tastenbilder, portiert aus docs/design/keys.js.
// Die Flächenfarben der Status kommen aus @agent-deck/shared (STATUS_COLORS),
// Schrift-, Label- und Blinkfarben gehören nur dem Renderer.

export interface StatusStyle {
  /** Flächenfarbe (laut) bzw. Farbe der Statusleiste (ruhig). */
  fill: string;
  /** Schriftfarbe auf der Fläche. */
  ink: string;
  /** Statuslabel in Versalien. */
  label: string;
}

export type Tool = "CC" | "CX";

export const TOKENS = {
  /** Grundfläche jeder Taste */
  bg: "#14171C",
  /** Innenfläche ruhiger Tasten */
  bgRaised: "#1E232B",
  text: "#F2F4F7",
  textDim: "#8A93A1",
  /** In keys.js heißt `needs_input` noch `approval`. */
  status: {
    needs_input: { fill: STATUS_COLORS.needs_input, ink: "#FFFFFF", label: "ANTWORT" },
    done: { fill: STATUS_COLORS.done, ink: "#1A1300", label: "FERTIG" },
    error: { fill: STATUS_COLORS.error, ink: "#FFFFFF", label: "FEHLER" },
    working: { fill: STATUS_COLORS.working, ink: "#FFFFFF", label: "ARBEITET" },
    idle: { fill: STATUS_COLORS.idle, ink: "#F2F4F7", label: "INAKTIV" },
    offline: { fill: STATUS_COLORS.offline, ink: "#8A93A1", label: "OFFLINE" },
  } satisfies Record<Status, StatusStyle>,
  /** Zweite Blinkphase von `needs_input` (dunkleres Rot). */
  blinkFill: "#8E2B2F",
  /** Claude Code / Codex */
  tool: { CC: "#D97757", CX: "#8E8CF5" } satisfies Record<Tool, string>,
  /** Akzentfarbe des Prompt-Makro-Symbols. */
  macroAccent: "#8E8CF5",
  font: "'Segoe UI', Inter, Arial, sans-serif",
} as const;
