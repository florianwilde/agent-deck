import type { WsMessage } from "@agent-deck/shared";
import { SessionIdSchema } from "@agent-deck/shared";
import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { isAuthorized, requireToken } from "../auth.ts";
import type { SessionHub } from "./hub.ts";

const HEARTBEAT_MS = 30_000;

/**
 * VPN-Listener für das Plugin: `GET /state`, `WS /ws`, `POST /sessions/:id/ack`, `GET /health`.
 * Alles außer `/health` verlangt `Authorization: Bearer <HUB_VPN_TOKEN>`.
 */
export function registerVpnRoutes(app: FastifyInstance, hub: SessionHub, vpnToken: string): void {
  const auth = requireToken(vpnToken);

  app.get("/state", { preHandler: auth }, async () => ({ sessions: hub.list() }));

  app.post<{ Params: { id: string } }>(
    "/sessions/:id/ack",
    { preHandler: auth },
    async (request, reply) => {
      const id = SessionIdSchema.safeParse(request.params.id);
      const session = id.success ? hub.acknowledge(id.data) : undefined;
      if (session === undefined) return reply.code(404).send({ error: "unknown session" });
      return { ok: true, session };
    },
  );

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const alive = new WeakMap<WebSocket, boolean>();

  const send = (socket: WebSocket, message: WsMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };

  wss.on("connection", (socket) => {
    alive.set(socket, true);
    socket.on("pong", () => alive.set(socket, true));
    // Das Plugin sendet (noch) nichts; eingehende Nachrichten werden ignoriert.
    send(socket, { type: "snapshot", sessions: hub.list() });
  });

  const unsubscribe = hub.subscribe((message) => {
    for (const socket of wss.clients) send(socket, message);
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== "/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    if (!isAuthorized(request.headers.authorization, vpnToken)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  };
  app.server.on("upgrade", onUpgrade);

  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
    unsubscribe();
    app.server.off("upgrade", onUpgrade);
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });
}
