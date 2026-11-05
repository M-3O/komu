import { createHash, timingSafeEqual } from "node:crypto";

import { projectBotSnapshot, type BotMonitoringSnapshot } from "./monitoring-snapshot";

import { createServer } from "node:http";
import type { Server } from "node:http";

/**
 * A tiny health/readiness server for the standalone Discord bot.
 *
 * Hosted platforms such as CranL expect an application to listen on a port
 * and answer a health check. The bot is a gateway connection, not an HTTP
 * app, so it needs this small listener to be deployable as its own service.
 *
 * The endpoint exposes no configuration: only whether Discord is connected
 * and how long the process has been up.
 */

export const DEFAULT_BOT_HEALTH_PORT = 3001;

export interface BotHealthServerOptions {
  /** Port to bind. Use 0 in tests to let the OS choose a free port. */
  port?: number;
  /** Whether the Discord gateway is ready. */
  isReady: () => boolean;
  /** Process start time, used for the uptime value. */
  startedAt?: number;
  monitoring?: { secret: string | undefined; snapshot: () => BotMonitoringSnapshot };
}

export interface BotHealthServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

export function readBotHealthPort(
  raw: string | undefined = process.env.PORT,
): number {
  if (!raw) return DEFAULT_BOT_HEALTH_PORT;

  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535; got "${raw}".`);
  }

  return port;
}

export async function startBotHealthServer(
  options: BotHealthServerOptions,
): Promise<BotHealthServer> {
  const startedAt = options.startedAt ?? Date.now();
  const port = options.port ?? readBotHealthPort();

  const secret = options.monitoring?.secret;
  const configured = typeof secret === "string" && /^[\x21-\x7e]{32,256}$/.test(secret);
  const expected = configured ? createHash("sha256").update(secret!).digest() : undefined;

  const server = createServer({ maxHeaderSize: 8_192 }, (request, response) => {
    const pathname = (request.url ?? "/").split("?")[0];

    if (pathname === "/internal/health") {
      const json = (status: number, value: unknown) => {
        const body = JSON.stringify(value);
        response.writeHead(status, { "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
        response.end(request.method === "HEAD" ? undefined : body);
      };
      if (!expected) { json(503, { error: "Monitoring unavailable." }); return; }
      const provided = request.headers["x-komu-monitoring-secret"];
      if (typeof provided !== "string" || provided.length > 256 ||
          !timingSafeEqual(createHash("sha256").update(provided).digest(), expected)) {
        json(401, { error: "Not authorised." }); return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
        response.end(); return;
      }
      try { json(200, projectBotSnapshot(options.monitoring!.snapshot())); }
      catch { json(503, { error: "Monitoring unavailable." }); }
      return;
    }

    if (pathname !== "/" && pathname !== "/health") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    let ready = false;
    try {
      ready = options.isReady();
    } catch {
      // A health check must never take the bot down. Treat a broken callback
      // as "not ready" and let the platform retry.
    }

    const body = JSON.stringify({
      status: ready ? "ok" : "starting",
      botReady: ready,
      uptimeSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1_000)),
    });

    response.writeHead(ready ? 200 : 503, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    });

    response.end(request.method === "HEAD" ? undefined : body);
  });

  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };

    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "0.0.0.0");
  });

  const address = server.address();
  const boundPort =
    typeof address === "object" && address !== null ? address.port : port;

  return {
    server,
    port: boundPort,
    close: async () => {
      if (!server.listening) return;

      await new Promise<void>((resolve, reject) => {
        server.closeIdleConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
