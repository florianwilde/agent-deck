import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { HubConfig } from "./config.ts";
import { registerCaptureRoutes } from "./capture/routes.ts";
import type { CaptureStore } from "./capture/store.ts";
import type { SessionHub } from "./normal/hub.ts";
import { registerPublicRoutes } from "./normal/public.ts";
import { registerVpnRoutes } from "./normal/vpn.ts";

export interface AppDeps {
  captureStore: CaptureStore;
}

/** `false` = keine Logs (Tests), sonst eine gemeinsame pino-Instanz. */
export type AppLogger = false | FastifyBaseLogger;

function createFastify(config: HubConfig, logger: AppLogger): FastifyInstance {
  return Fastify({
    bodyLimit: config.bodyLimit,
    trustProxy: true,
    ...(logger === false ? { logger: false } : { loggerInstance: logger }),
  }) as unknown as FastifyInstance;
}

/** Capture-Modus (Phase 0): ein Listener, speichert rohe Payloads. */
export function buildApp(config: HubConfig, deps: AppDeps, logger: AppLogger): FastifyInstance {
  if (config.mode !== "capture") {
    throw new Error(
      "buildApp ist nur für HUB_MODE=capture, im Normalbetrieb buildNormalApps nutzen",
    );
  }
  const app = createFastify(config, logger);
  app.get("/health", async () => ({ ok: true, mode: config.mode }));
  registerCaptureRoutes(app, deps.captureStore, config.token);
  return app;
}

export interface NormalApps {
  /** Öffentlich über den Reverse Proxy: `POST /events`. */
  publicApp: FastifyInstance;
  /** Nur im VPN: `GET /state`, `WS /ws`, `POST /sessions/:id/ack`. */
  vpnApp: FastifyInstance;
}

/** Normalbetrieb: zwei getrennte Listener auf einem gemeinsamen {@link SessionHub}. */
export async function buildNormalApps(
  config: HubConfig,
  hub: SessionHub,
  logger: AppLogger,
): Promise<NormalApps> {
  const publicApp = createFastify(config, logger);
  publicApp.get("/health", async () => ({ ok: true, mode: config.mode }));
  await registerPublicRoutes(publicApp, hub, config);

  const vpnApp = createFastify(config, logger);
  vpnApp.get("/health", async () => ({ ok: true, mode: config.mode }));
  registerVpnRoutes(vpnApp, hub, config.vpnToken);

  return { publicApp, vpnApp };
}
