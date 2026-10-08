/**
 * Small logging helper.
 *
 * V1 uses plain console output with a consistent prefix, per PRD section 13
 * (server logs, bot logs, error logs). Swap the implementation for a real
 * logger later without touching call sites.
 */

export type LogScope =
  | "server"
  | "bot"
  | "db"
  | "auth"
  | "stream"
  | "discord"
  | "xp";

function write(
  scope: LogScope,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  context?: Record<string, unknown>,
) {
  const entry = {
    time: new Date().toISOString(),
    scope,
    level,
    message,
    ...(context ? { context } : {}),
  };

  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else if (level === "debug") {
    // Expected-path detail: noise during normal operation, so it is off in
    // production unless something is wrong.
    if (process.env.NODE_ENV !== "production") {
      console.log(line);
    }
  } else {
    console.log(line);
  }
}

/** Create a logger bound to an area of the app. */
export function createLogger(scope: LogScope) {
  return {
    debug: (message: string, context?: Record<string, unknown>) =>
      write(scope, "debug", message, context),
    info: (message: string, context?: Record<string, unknown>) =>
      write(scope, "info", message, context),
    warn: (message: string, context?: Record<string, unknown>) =>
      write(scope, "warn", message, context),
    error: (message: string, context?: Record<string, unknown>) =>
      write(scope, "error", message, context),
  };
}

export const logger = createLogger("server");