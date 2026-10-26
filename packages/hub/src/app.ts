import Fastify, { type FastifyInstance } from "fastify";
import type { HubConfig } from "./config.ts";
import { registerCaptureRoutes } from "./capture/routes.ts";
import type { CaptureStore } from "./capture/store.ts";

export interface AppDeps {
  captureStore: CaptureStore;
}

export function buildApp(
  config: HubConfig,
  deps: AppDeps,
  logger: boolean | { level: string } = { level: config.logLevel },
): FastifyInstance {
  const app = Fastify({
    bodyLimit: config.bodyLimit,
    trustProxy: true,
    logger:
      logger === false
        ? false
        : {
            ...(logger === true ? {} : logger),
            redact: ["req.headers.authorization", "req.headers.cookie"],
          },
  });

  app.get("/health", async () => ({ ok: true, mode: config.mode }));

  if (config.mode === "capture") {
    registerCaptureRoutes(app, deps.captureStore, config.token);
  } else {
    throw new Error('HUB_MODE="normal" kommt erst in Phase 1 – bitte HUB_MODE=capture setzen');
  }

  return app;
}
