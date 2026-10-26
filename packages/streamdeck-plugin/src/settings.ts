/** UUID des Plugins (Manifest). */
export const PLUGIN_UUID = "de.wildeflorian.agentdeck";
/** UUID der Aktion „Projekt-Slot“. */
export const SLOT_ACTION_UUID = `${PLUGIN_UUID}.slot`;

/** Inaktiv-Timeouts, die der Property Inspector anbietet (Minuten). Der Hub setzt fest nach 30 Min. `idle`. */
export const INACTIVE_TIMEOUTS_MIN = [10, 15, 30] as const;

/**
 * Globale Einstellungen (einmal pro Plugin). Werden im Property Inspector per
 * `sdpi-*`-Komponente mit Attribut `global` gespeichert. Alle Felder optional,
 * weil Stream Deck anfangs ein leeres Objekt liefert.
 */
export interface GlobalSettings {
  [key: string]: string | undefined;
  /** VPN-Listener des Hubs, z. B. `http://10.1.5.229:8788` (WebSocket-URL wird daraus abgeleitet). */
  hubUrl?: string;
  /** `HUB_VPN_TOKEN`, nur in den Stream-Deck-Einstellungen, nie im Repo. */
  token?: string;
  /** Wohin ein Tastendruck die Session öffnet. */
  openIn?: "browser" | "app";
  /** Minuten ohne Event, nach denen eine Taste `idle` zeigt (Text, weil sdpi-select Strings speichert). */
  inactiveMinutes?: string;
  /** Ton bei Rot (erst ab Phase 4 wirksam). */
  sound?: "off" | "once" | "always";
}

/** Einstellungen einer Slot-Taste. */
export interface SlotSettings {
  [key: string]: string | undefined;
  /** `auto`: nach Tastenposition bzw. `position`; `fixed`: immer `repo`. */
  mode?: "auto" | "fixed";
  /** Bei `auto`: leer = nach Tastenposition, sonst Rang `1`…`32` (n. dringendste Session). */
  position?: string;
  /** Bei `fixed`: `owner/repo`. */
  repo?: string;
  /** Anzeigename statt Repo-Name (leer = aus Repo-Name). */
  displayName?: string;
}

/** Verbindungsstatus, wie ihn der Property Inspector anzeigt. */
export interface ConnectionStatus {
  state: "unconfigured" | "connecting" | "connected" | "disconnected";
  sessions: number;
  /** Kurzer Fehlertext, z. B. `401 Unauthorized`. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Nachrichten Property Inspector ↔ Plugin (sendToPlugin / sendToPropertyInspector)
// ---------------------------------------------------------------------------

/** Property Inspector → Plugin. `repos` ist die sdpi-`datasource`-Anfrage. */
export type PiToPlugin = { event: "getStatus" } | { event: "testConnection" } | { event: "repos" };

/** Plugin → Property Inspector. */
export type PluginToPi =
  | { event: "status"; status: ConnectionStatus }
  | { event: "testResult"; ok: boolean; message: string }
  | { event: "repos"; items: { label: string; value: string }[] };
