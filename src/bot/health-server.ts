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

  const server = createServer((request, response) => {
    const pathname = (request.url ?? "/").split("?")[0];

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
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
