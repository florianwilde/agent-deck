import { type Session, type Status, STATUS_PRIORITY } from "@agent-deck/shared";
import type { SlotSettings } from "./settings.ts";

/** Eine sichtbare Slot-Taste. */
export interface SlotInfo {
  id: string;
  device: string;
  row: number;
  column: number;
  settings: SlotSettings;
}

/** Session mit dem Status, den die Taste zeigt (lokaler Inaktiv-Timeout schon angewandt). */
export interface ViewSession {
  session: Session;
  status: Status;
  /** Seit wann `status` gilt (ms). */
  since: number;
}

/** Was eine Slot-Taste zeigt: die dringendste Session und wie viele es insgesamt sind. */
export interface SlotAssignment {
  view: ViewSession | undefined;
  /** Anzahl Sessions hinter der Taste (bei „Fest“ alle Sessions des Repos). */
  count: number;
}

/**
 * Status für die Anzeige. Der Hub setzt nach 30 Min. ohne Event `idle`; ist im Plugin ein
 * kürzerer Inaktiv-Timeout eingestellt, greift er hier schon früher.
 */
export function viewSession(session: Session, now: number, inactiveMs: number): ViewSession {
  const lastEvent = Date.parse(session.lastEventAt);
  if (session.status !== "idle" && session.status !== "offline" && now - lastEvent >= inactiveMs) {
    return { session, status: "idle", since: lastEvent + inactiveMs };
  }
  return { session, status: session.status, since: Date.parse(session.since) };
}

/** Priorität (Status), dann `since` aufsteigend: wer am längsten wartet, kommt zuerst. */
export function compareViews(a: ViewSession, b: ViewSession): number {
  return (
    STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] ||
    a.since - b.since ||
    a.session.id.localeCompare(b.session.id)
  );
}

/** Tasten nach Gerät, Zeile, Spalte. */
export function compareSlots(a: SlotInfo, b: SlotInfo): number {
  return (
    a.device.localeCompare(b.device) ||
    a.row - b.row ||
    a.column - b.column ||
    a.id.localeCompare(b.id)
  );
}

/** Rang aus der Einstellung „Position“ (1-basiert) oder `undefined` für „nach Tastenposition“. */
function explicitRank(settings: SlotSettings): number | undefined {
  const value = Number.parseInt(settings.position ?? "", 10);
  return Number.isInteger(value) && value >= 1 ? value - 1 : undefined;
}

/**
 * Verteilt die Sessions auf die Slots.
 * - „Fest“: Die Taste zeigt die dringendste Session ihres Repos; diese Sessions fallen aus der automatischen Verteilung.
 * - „Automatisch“ mit Position n: die n.-dringendste der übrigen Sessions.
 * - „Automatisch“ ohne Position: die übrigen Ränge der Reihe nach, Tasten sortiert nach Zeile, dann Spalte.
 */
export function assignSlots(
  slots: readonly SlotInfo[],
  sessions: readonly Session[],
  now: number,
  inactiveMs: number,
): Map<string, SlotAssignment> {
  const views = sessions.map((session) => viewSession(session, now, inactiveMs)).sort(compareViews);
  const result = new Map<string, SlotAssignment>();
  const fixedRepos = new Set<string>();

  for (const slot of slots) {
    if (slot.settings.mode !== "fixed") continue;
    const repo = slot.settings.repo ?? "";
    if (repo) fixedRepos.add(repo);
    const matching = views.filter((view) => view.session.repo === repo);
    result.set(slot.id, { view: matching[0], count: matching.length });
  }

  const pool = views.filter((view) => !fixedRepos.has(view.session.repo));
  const auto = slots.filter((slot) => slot.settings.mode !== "fixed").sort(compareSlots);
  const claimed = new Set<number>();
  for (const slot of auto) {
    const rank = explicitRank(slot.settings);
    if (rank !== undefined) claimed.add(rank);
  }

  let next = 0;
  for (const slot of auto) {
    let rank = explicitRank(slot.settings);
    if (rank === undefined) {
      while (claimed.has(next)) next++;
      rank = next++;
    }
    const view = pool[rank];
    result.set(slot.id, { view, count: view === undefined ? 0 : 1 });
  }
  return result;
}

/** Anzeigename: Einstellung, sonst Repo ohne Besitzer (`owner/repo` → `repo`). */
export function displayName(repo: string, settings: SlotSettings): string {
  const custom = settings.displayName?.trim();
  if (custom) return custom;
  const slash = repo.lastIndexOf("/");
  return slash >= 0 ? repo.slice(slash + 1) : repo;
}

/** Ziel eines kurzen Tastendrucks. `app`: dasselbe Ziel über das `claude://`-Schema der Claude-App. */
export function openTarget(view: ViewSession | undefined, openIn: string | undefined): string {
  const url = view?.session.url || "https://claude.ai/code";
  return openIn === "app" ? url.replace(/^https:\/\//, "claude://") : url;
}
