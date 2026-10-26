import { z } from "zod";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Status einer Session, nach Priorität absteigend (siehe CLAUDE.md). */
export const STATUSES = ["needs_input", "done", "error", "working", "idle", "offline"] as const;
export const StatusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof StatusSchema>;

/** Kleinere Zahl = wichtiger. Für Sortierung und Ampel. */
export const STATUS_PRIORITY: Record<Status, number> = {
  needs_input: 0,
  done: 1,
  error: 2,
  working: 3,
  idle: 4,
  offline: 5,
};

export const STATUS_COLORS: Record<Status, string> = {
  needs_input: "#E5484D",
  done: "#F5B83D",
  error: "#F76B15",
  working: "#30A46C",
  idle: "#5B6470",
  offline: "#3A404A",
};

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

/** Max. Länge von `message` im Hook-Event (Zeichen). */
export const MESSAGE_MAX_LENGTH = 120;
/** Max. Request-Body für die öffentlichen Endpunkte (Bytes). */
export const PUBLIC_BODY_LIMIT = 4096;

const MINUTE = 60_000;
/** `working` ohne Event → `idle` (Abbruch per Stopp-Knopf liefert kein Event). */
export const WORKING_TIMEOUT_MS = 10 * MINUTE;
/** Beliebiger Status ohne Event → `idle` (Ersatz für das fehlende `SessionEnd`). */
export const IDLE_TIMEOUT_MS = 30 * MINUTE;
/** Nach `SessionEnd` wird die Session so lange später entfernt. */
export const ENDED_REMOVE_MS = 10 * MINUTE;
/** `idle` ohne Event → entfernen (archivierte Sessions, die kein `SessionEnd` senden). */
export const IDLE_REMOVE_MS = 24 * 60 * MINUTE;

/** Hook-Events, die `agent-deck init` registriert (docs/event-mapping.md). */
export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "Stop",
  "StopFailure",
  "SessionEnd",
] as const;
export type HookEventName = (typeof HOOK_EVENTS)[number];
/** Diese Events laufen synchron (ab Phase 3 fragt der Stop-Hook die Queue ab). */
export const SYNC_HOOK_EVENTS: readonly HookEventName[] = ["Stop"];
/** `timeout` in Sekunden für synchrone Hooks. */
export const SYNC_HOOK_TIMEOUT_S = 5;

// ---------------------------------------------------------------------------
// Hook-Event (Hook → Hub, POST /events)
// ---------------------------------------------------------------------------

/** Session-Key: `cse_…` aus CLAUDE_CODE_REMOTE_SESSION_ID oder die Payload-`session_id`. */
export const SessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

/**
 * Was der Hook sendet. Nur Metadaten, keine Prompts, Tool-Inputs oder Inhalte.
 * Unbekannte Felder werden verworfen (zod `strip`).
 */
export const HookEventSchema = z.object({
  v: z.literal(1),
  /** `hook_event_name` aus dem Payload. */
  event: z.string().regex(/^[A-Za-z]{1,64}$/),
  sessionId: SessionIdSchema,
  /** `owner/repo` oder Verzeichnisname. */
  repo: z.string().min(1).max(200),
  branch: z.string().min(1).max(200).optional(),
  /** Zeitstempel des Hooks (ISO 8601, UTC), nicht die Ankunftszeit. */
  ts: z.iso.datetime(),
  /** `Notification.notification_type`. */
  notificationType: z.string().max(64).optional(),
  /** `SessionStart.source` bzw. `SessionEnd.reason`. */
  source: z.string().max(64).optional(),
  /** `Notification.message`, `StopFailure.error` oder `PermissionRequest.tool_name`. */
  message: z
    .string()
    .max(1000)
    .transform((value) => value.slice(0, MESSAGE_MAX_LENGTH))
    .optional(),
});
export type HookEvent = z.infer<typeof HookEventSchema>;

// ---------------------------------------------------------------------------
// Session (Hub → Plugin)
// ---------------------------------------------------------------------------

export const SessionSchema = z.object({
  id: SessionIdSchema,
  repo: z.string(),
  branch: z.string().nullable(),
  url: z.string(),
  status: StatusSchema,
  /** Seit wann der aktuelle Status gilt (ISO). */
  since: z.iso.datetime(),
  /** Zeitstempel des letzten ausgewerteten Events (ISO). */
  lastEventAt: z.iso.datetime(),
  lastMessage: z.string().nullable(),
  queueCount: z.number().int().nonnegative(),
  acknowledged: z.boolean(),
  lastPromptAt: z.iso.datetime().nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

/** Web-URL zur Session; ohne `cse_`-Key nur die Übersicht. */
export function sessionUrl(id: string): string {
  return id.startsWith("cse_")
    ? `https://claude.ai/code/session_${id.slice(4)}`
    : "https://claude.ai/code";
}

// ---------------------------------------------------------------------------
// WebSocket-Nachrichten (Hub → Plugin, WS /ws)
// ---------------------------------------------------------------------------

export const WsMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), sessions: z.array(SessionSchema) }),
  z.object({ type: z.literal("session.upsert"), session: SessionSchema }),
  z.object({ type: z.literal("session.remove"), id: SessionIdSchema }),
]);
export type WsMessage = z.infer<typeof WsMessageSchema>;
