import { pino } from "pino";
import { buildApp, buildNormalApps } from "./app.ts";
import { CaptureStore } from "./capture/store.ts";
import { loadConfig } from "./config.ts";
import { SessionHub } from "./normal/hub.ts";
import { SessionStore } from "./normal/store.ts";

/** Abstand, in dem die Timeouts geprüft werden. */
const TICK_MS = 30_000;

const config = loadConfig();
const logger = pino({
  level: config.logLevel,
  redact: ["req.headers.authorization", "req.headers.cookie"],
});

const closers: (() => Promise<void> | void)[] = [];

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "shutting down");
  for (const close of closers.reverse()) await close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  if (config.mode === "capture") {
    const captureStore = new CaptureStore(config.dbPath);
    const app = buildApp(config, { captureStore }, logger);
    closers.push(
      () => captureStore.close(),
      () => app.close(),
    );
    await app.listen({ host: config.host, port: config.port });
  } else {
    const store = new SessionStore(config.dbPath);
    const leftovers = store.captureRows();
    if (leftovers > 0) {
      logger.warn(
        { rows: leftovers },
        "Capture-Daten aus Phase 0 liegen noch in der Datenbank – siehe docs/setup-hub.md, Schritt „Capture-Daten löschen“",
      );
    }
    const hub = new SessionHub(store);
    const { publicApp, vpnApp } = await buildNormalApps(config, hub, logger);
    const tick = setInterval(() => hub.tick(), TICK_MS);
    closers.push(
      () => store.close(),
      () => clearInterval(tick),
      () => publicApp.close(),
      () => vpnApp.close(),
    );
    hub.tick();
    await publicApp.listen({ host: config.host, port: config.port });
    await vpnApp.listen({ host: config.vpnHost, port: config.vpnPort });
  }
  logger.info(
    {
      mode: config.mode,
      db: config.dbPath,
      public: `${config.host}:${config.port}`,
      ...(config.mode === "normal" ? { vpn: `${config.vpnHost}:${config.vpnPort}` } : {}),
    },
    "agent-deck hub ready",
  );
} catch (error) {
  logger.error(error);
  process.exit(1);
}
