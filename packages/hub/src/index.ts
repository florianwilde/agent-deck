import { buildApp } from "./app.ts";
import { CaptureStore } from "./capture/store.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const captureStore = new CaptureStore(config.dbPath);
const app = buildApp(config, { captureStore });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  captureStore.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ mode: config.mode, db: config.dbPath }, "agent-deck hub ready");
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
