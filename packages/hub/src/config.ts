import { PUBLIC_BODY_LIMIT } from "@agent-deck/shared";

export type HubMode = "capture" | "normal";

export interface HubConfig {
  mode: HubMode;
  /** Bearer-Token für die öffentlichen Endpunkte (Network Secret der Cloud-Umgebung). */
  token: string;
  /** Öffentlicher Listener (Ziel des Reverse Proxys). */
  host: string;
  port: number;
  /** Bearer-Token für die VPN-Endpunkte (Plugin). Nur im Normalbetrieb. */
  vpnToken: string;
  /** VPN-Listener (GET /state, WS /ws, …). Nur im Normalbetrieb. */
  vpnHost: string;
  vpnPort: number;
  dbPath: string;
  /** Max. Request-Body in Bytes (öffentlicher Listener). */
  bodyLimit: number;
  /** Max. Requests pro Minute und IP auf den öffentlichen Endpunkten. */
  rateLimit: number;
  logLevel: string;
}

const MIN_TOKEN_LENGTH = 32;

function parseIntVar(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} muss eine positive ganze Zahl sein, ist aber "${raw}"`);
  }
  return value;
}

function requireTokenVar(env: NodeJS.ProcessEnv, name: string): string {
  const token = env[name] ?? "";
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `${name} fehlt oder ist kürzer als ${MIN_TOKEN_LENGTH} Zeichen (z. B. "openssl rand -hex 32")`,
    );
  }
  return token;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const mode = env.HUB_MODE ?? "capture";
  if (mode !== "capture" && mode !== "normal") {
    throw new Error(`HUB_MODE muss "capture" oder "normal" sein, ist aber "${mode}"`);
  }

  const token = requireTokenVar(env, "HUB_TOKEN");

  let vpnToken = "";
  if (mode === "normal") {
    vpnToken = requireTokenVar(env, "HUB_VPN_TOKEN");
    if (vpnToken === token) {
      throw new Error("HUB_VPN_TOKEN muss sich von HUB_TOKEN unterscheiden");
    }
  }

  const config: HubConfig = {
    mode,
    token,
    host: env.HUB_HOST ?? "0.0.0.0",
    port: parseIntVar(env, "HUB_PORT", 8787),
    vpnToken,
    vpnHost: env.HUB_VPN_HOST ?? "127.0.0.1",
    vpnPort: parseIntVar(env, "HUB_VPN_PORT", 8788),
    dbPath: env.HUB_DB_PATH ?? "./data/agent-deck.db",
    // Im Normalbetrieb fest 4 KB (CLAUDE.md); HUB_BODY_LIMIT gilt nur für den Capture-Modus.
    bodyLimit:
      mode === "capture" ? parseIntVar(env, "HUB_BODY_LIMIT", 256 * 1024) : PUBLIC_BODY_LIMIT,
    rateLimit: parseIntVar(env, "HUB_RATE_LIMIT", 60),
    logLevel: env.HUB_LOG_LEVEL ?? "info",
  };

  if (mode === "normal" && config.vpnPort === config.port) {
    throw new Error("HUB_VPN_PORT muss sich von HUB_PORT unterscheiden");
  }
  return config;
}
