import type { FastifyInstance } from "fastify";
import { requireToken } from "../auth.ts";
import { sanitizeHeaders, type CaptureStore } from "./store.ts";

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10_000;

interface CaptureQuery {
  since?: string;
  limit?: string;
}

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function registerCaptureRoutes(
  app: FastifyInstance,
  store: CaptureStore,
  token: string,
): void {
  // Body als Rohtext annehmen, egal welcher Content-Type, damit er unverändert gespeichert wird.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  const auth = requireToken(token);

  app.post("/events", { preHandler: auth }, async (request, reply) => {
    const body = typeof request.body === "string" ? request.body : "";
    const id = store.insert({
      receivedAt: new Date().toISOString(),
      remoteAddress: request.ip,
      headers: sanitizeHeaders(request.headers),
      body,
    });
    request.log.debug({ id, bytes: body.length }, "capture stored");
    return reply.code(202).send({ ok: true, id });
  });

  app.get<{ Querystring: CaptureQuery }>(
    "/capture",
    { preHandler: auth },
    async (request, reply) => {
      const { since, limit } = request.query;

      let sinceIso = new Date(0).toISOString();
      if (since !== undefined && since !== "") {
        const parsed = new Date(since);
        if (Number.isNaN(parsed.getTime())) {
          return reply.code(400).send({ error: "since muss ein ISO-8601-Zeitpunkt sein" });
        }
        sinceIso = parsed.toISOString();
      }

      let max = DEFAULT_LIMIT;
      if (limit !== undefined && limit !== "") {
        max = Number(limit);
        if (!Number.isInteger(max) || max < 1 || max > MAX_LIMIT) {
          return reply.code(400).send({ error: `limit muss zwischen 1 und ${MAX_LIMIT} liegen` });
        }
      }

      const entries = store.list(sinceIso, max).map((entry) => ({
        ...entry,
        json: parseBody(entry.body),
      }));
      return { count: entries.length, entries };
    },
  );
}
