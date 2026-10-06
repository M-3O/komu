/**
 * Small logging helper.
 *
 * V1 uses plain console output with a consistent prefix, per PRD section 13
 * (server logs, bot logs, error logs). Swap the implementation for a real
 * logger later without touching call sites.
 */

export type LogScope = "server" | "bot" | "db" | "auth" | "stream";

function write(
  scope: LogScope,
  level: "info" | "warn" | "error",
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
  } else {
    console.log(line);
  }
}

/** Create a logger bound to an area of the app. */
export function createLogger(scope: LogScope) {
  return {
    info: (message: string, context?: Record<string, unknown>) =>
      write(scope, "info", message, context),
    warn: (message: string, context?: Record<string, unknown>) =>
      write(scope, "warn", message, context),
    error: (message: string, context?: Record<string, unknown>) =>
      write(scope, "error", message, context),
  };
}

export const logger = createLogger("server");