import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Vergleicht den Bearer-Token in konstanter Zeit. */
export function isAuthorized(header: string | undefined, token: string): boolean {
  if (header === undefined) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match?.[1] === undefined) return false;
  return timingSafeEqual(digest(match[1]), digest(token));
}

export function requireToken(token: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!isAuthorized(request.headers.authorization, token)) {
      await reply.code(401).send({ error: "unauthorized" });
    }
  };
}
