import type { Client } from "discord.js";
import { createLogger } from "@/lib/logger";
import { registerProcessHandlers } from "./events/error-handlers";
import { GatewayHealth } from "./gateway-health";
import { startBotHealthServer, type BotHealthServer } from "./health-server";
import { botMonitoringSnapshot } from "./monitoring-snapshot";
import { BotShutdown } from "./shutdown";
import { botWork, type BotWorkTracker } from "./work-tracker";

const HEARTBEAT_INTERVAL_MS = 60_000;

interface RuntimeOptions {
  client: Client;
  login: () => Promise<unknown>;
  configure: () => void;
  disconnectDatabase: () => Promise<unknown>;
  monitoringSecret?: string;
  work?: BotWorkTracker;
  processSource?: Pick<NodeJS.Process, "on" | "off">;
  exit?: (code: number) => void;
  startHealth?: typeof startBotHealthServer;
  publishHeartbeat?: (ready: boolean) => Promise<void>;
}

/** Injectable runtime; unit tests never construct a live client or database. */
export async function startBotRuntime(options: RuntimeOptions) {
  const log = createLogger("bot");
  const source = options.processSource ?? process;
  const work = options.work ?? botWork;
  const gateway = new GatewayHealth(options.client);
  let healthServer: BotHealthServer | undefined;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;
  const exit = options.exit ?? (code => process.exit(code));
  let removeFatal = () => {};
  const shutdown = new BotShutdown({ gateway, work,
    closeHealth: () => {
      clearTimeout(heartbeatTimer);
      return healthServer?.close() ?? Promise.resolve();
    },
    destroyClient: () => options.client.destroy(),
    disconnectDatabase: options.disconnectDatabase,
    exit: code => {
      removeFatal();
      source.off("SIGINT", interrupt);
      source.off("SIGTERM", terminate);
      gateway.dispose();
      exit(code);
    },
    report: code => log.info("Bot shutdown", { code }),
  });
  const request = (reason: "SIGINT" | "SIGTERM" | "FATAL" | "STARTUP_FAILURE") => {
    stopping = true;
    void shutdown.request(reason).catch(() => exit(1));
  };
  const interrupt = () => request("SIGINT");
  const terminate = () => request("SIGTERM");
  removeFatal = registerProcessHandlers(() => request("FATAL"), source);
  source.on("SIGINT", interrupt);
  source.on("SIGTERM", terminate);
  try {
    healthServer = await (options.startHealth ?? startBotHealthServer)({
      isReady: () => gateway.snapshot().ready,
      monitoring: { secret: options.monitoringSecret,
        snapshot: () => botMonitoringSnapshot(gateway.snapshot(), work.inFlight) },
    });
    if (stopping) {
      void healthServer.close().catch(() => undefined);
      return { gateway, work, shutdown };
    }
    log.info("Bot health server listening", { port: healthServer.port });
    options.configure();
    const publishHeartbeat = options.publishHeartbeat;
    if (publishHeartbeat) {
      const heartbeat = async () => {
        if (!work.isAccepting) return;
        try {
          await publishHeartbeat(gateway.snapshot().ready);
        } catch {
          // The dashboard ages out the last successful heartbeat.
        }
        if (work.isAccepting) heartbeatTimer = setTimeout(heartbeat, HEARTBEAT_INTERVAL_MS).unref();
      };
      void heartbeat();
    }
    if (!stopping) await options.login();
    // Login resolving does not establish current readiness; gateway state does.
  } catch {
    if (!stopping) {
      log.error("Bot startup failed", { code: "BOT_STARTUP_FAILED" });
      await shutdown.request("STARTUP_FAILURE");
    }
  }
  return { gateway, work, shutdown };
}
