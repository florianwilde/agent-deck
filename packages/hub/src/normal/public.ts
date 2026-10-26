import rateLimit from "@fastify/rate-limit";
import { HookEventSchema } from "@agent-deck/shared";
import type { FastifyInstance } from "fastify";
import { requireToken } from "../auth.ts";
import type { HubConfig } from "../config.ts";
import type { SessionHub } from "./hub.ts";

/** Öffentlicher Listener (über den Reverse Proxy): nur `POST /events` und `GET /health`. */
export async function registerPublicRoutes(
  app: FastifyInstance,
  hub: SessionHub,
  config: HubConfig,
): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    max: config.rateLimit,
    timeWindow: "1 minute",
  });

  app.post(
    "/events",
    {
      // Rate-Limit vor dem Token-Check, damit auch falsche Tokens gezählt werden.
      config: { rateLimit: { max: config.rateLimit, timeWindow: "1 minute" } },
      preHandler: requireToken(config.token),
    },
    async (request, reply) => {
      const parsed = HookEventSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid event" });
      }
      const event = parsed.data;
      const result = hub.ingest(event);
      request.log.debug({ event: event.event, session: event.sessionId, applied: result.applied });
      if (result.statusChanged && result.session !== undefined) {
        request.log.info(
          { session: result.session.id, repo: result.session.repo, status: result.session.status },
          "status changed",
        );
      }
      return reply.code(202).send({ ok: true });
    },
  );
}
