export type HubMode = "capture" | "normal";

export interface HubConfig {
  mode: HubMode;
  token: string;
  host: string;
  port: number;
  dbPath: string;
  /** Max. Request-Body in Bytes. */
  bodyLimit: number;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const mode = env.HUB_MODE ?? "capture";
  if (mode !== "capture" && mode !== "normal") {
    throw new Error(`HUB_MODE muss "capture" oder "normal" sein, ist aber "${mode}"`);
  }

  const token = env.HUB_TOKEN ?? "";
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `HUB_TOKEN fehlt oder ist kürzer als ${MIN_TOKEN_LENGTH} Zeichen (z. B. "openssl rand -hex 32")`,
    );
  }

  return {
    mode,
    token,
    host: env.HUB_HOST ?? "0.0.0.0",
    port: parseIntVar(env, "HUB_PORT", 8787),
    dbPath: env.HUB_DB_PATH ?? "./data/agent-deck.db",
    bodyLimit: parseIntVar(env, "HUB_BODY_LIMIT", 256 * 1024),
    logLevel: env.HUB_LOG_LEVEL ?? "info",
  };
}
