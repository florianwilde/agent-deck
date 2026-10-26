import {
  ENDED_REMOVE_MS,
  IDLE_REMOVE_MS,
  IDLE_TIMEOUT_MS,
  WORKING_TIMEOUT_MS,
  sessionUrl,
  type HookEvent,
  type Session,
  type Status,
} from "@agent-deck/shared";

/** Session plus Felder, die nur der Hub braucht. */
export interface SessionRecord extends Session {
  /** Hub-Zeit des letzten ausgewerteten Events, Basis für die Timeouts. */
  lastSeenAt: string;
  /** Hub-Zeit des `SessionEnd`, danach wird die Session entfernt. */
  endedAt: string | null;
}

/** `notification_type`-Werte, die „wartet auf mich“ bedeuten (docs/event-mapping.md). */
const NEEDS_INPUT_NOTIFICATIONS = new Set([
  "permission_prompt",
  "idle_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
]);

const WORKING_EVENTS = new Set([
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "PreCompact",
  "PostCompact",
]);

/** Status, den ein Event setzt, oder `null`, wenn das Event ignoriert wird. */
export function statusForEvent(event: HookEvent): Status | null {
  switch (event.event) {
    case "PermissionRequest":
      return "needs_input";
    case "Notification":
      return NEEDS_INPUT_NOTIFICATIONS.has(event.notificationType ?? "") ? "needs_input" : null;
    case "Stop":
      // Phase 3: Hat der Hub in diesem Stop einen Queue-Eintrag ausgeliefert → working.
      return "done";
    case "StopFailure":
      return "error";
    case "SessionStart":
      return event.source === "resume" || event.source === "clear" ? "idle" : "working";
    case "SessionEnd":
      return "idle";
    default:
      return WORKING_EVENTS.has(event.event) ? "working" : null;
  }
}

/** Ergebnis von {@link applyEvent}: `null` = Event ignoriert, Session unverändert. */
export function applyEvent(
  session: SessionRecord | undefined,
  event: HookEvent,
  now: Date,
): SessionRecord | null {
  const status = statusForEvent(event);
  if (status === null) return null;
  // Async-Hooks kommen ungeordnet an: ältere Events als der aktuelle Stand verwerfen.
  if (session !== undefined && Date.parse(event.ts) < Date.parse(session.lastEventAt)) return null;

  const nowIso = now.toISOString();
  const changed = session?.status !== status;
  return {
    id: event.sessionId,
    repo: event.repo,
    branch: event.branch ?? session?.branch ?? null,
    url: sessionUrl(event.sessionId),
    status,
    since: changed ? event.ts : (session?.since ?? event.ts),
    lastEventAt: event.ts,
    lastMessage: event.message ?? (changed ? null : (session?.lastMessage ?? null)),
    queueCount: session?.queueCount ?? 0,
    acknowledged: false,
    lastPromptAt: event.event === "UserPromptSubmit" ? event.ts : (session?.lastPromptAt ?? null),
    lastSeenAt: nowIso,
    endedAt: event.event === "SessionEnd" ? nowIso : null,
  };
}

export type TimeoutResult =
  { action: "keep" } | { action: "update"; session: SessionRecord } | { action: "remove" };

/** Timeouts aus docs/event-mapping.md plus Aufräumen beendeter und lange inaktiver Sessions. */
export function applyTimeouts(session: SessionRecord, now: Date): TimeoutResult {
  const t = now.getTime();
  if (session.endedAt !== null && t - Date.parse(session.endedAt) >= ENDED_REMOVE_MS) {
    return { action: "remove" };
  }
  if (session.status === "idle") {
    return t - Date.parse(session.since) >= IDLE_REMOVE_MS
      ? { action: "remove" }
      : { action: "keep" };
  }

  const silent = t - Date.parse(session.lastSeenAt);
  const timedOut =
    silent >= IDLE_TIMEOUT_MS || (session.status === "working" && silent >= WORKING_TIMEOUT_MS);
  if (!timedOut) return { action: "keep" };
  return {
    action: "update",
    session: { ...session, status: "idle", since: now.toISOString(), lastMessage: null },
  };
}

/** Öffentliche Sicht (ohne Hub-interne Felder). */
export function toSession(record: SessionRecord): Session {
  const { lastSeenAt, endedAt, ...session } = record;
  void lastSeenAt;
  void endedAt;
  return session;
}
