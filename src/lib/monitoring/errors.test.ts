import { describe, expect, it } from "vitest";
import { classifyError, ERROR_CODES } from "./errors";

describe("allowlisted error classification", () => {
  it.each([
    ["discord", { status: 401 }, "DISCORD_AUTH_FAILED"],
    ["discord", { status: 403 }, "DISCORD_PERMISSION_DENIED"],
    ["discord", { code: 50001 }, "DISCORD_PERMISSION_DENIED"],
    ["discord", { code: "DISCORD_50013" }, "DISCORD_PERMISSION_DENIED"],
    ["discord", { status: 404 }, "DISCORD_RESOURCE_UNAVAILABLE"],
    ["discord", { status: 429 }, "DISCORD_RATE_LIMITED"],
    ["discord", { name: "TimeoutError" }, "DISCORD_TIMEOUT"],
    ["discord", { code: "NETWORK" }, "DISCORD_NETWORK"],
    ["postgres", { code: "P1000" }, "DATABASE_AUTH_FAILED"],
    ["postgres", { code: "P1001" }, "DATABASE_UNREACHABLE"],
    ["postgres", { code: "P2024" }, "DATABASE_POOL_TIMEOUT"],
    ["postgres", { code: "P1011" }, "DATABASE_TLS_FAILED"],
    ["postgres", { code: "P2028" }, "DATABASE_TRANSACTION_FAILED"],
    ["postgres", { code: "P2034" }, "DATABASE_TRANSACTION_FAILED"],
    ["postgres", { code: "40P01" }, "DATABASE_TRANSACTION_FAILED"],
    ["provider", { code: "NOT_CONFIGURED" }, "PROVIDER_NOT_CONFIGURED"],
    ["provider", { status: 401 }, "PROVIDER_AUTH_FAILED"],
    ["provider", { status: 403 }, "PROVIDER_PERMISSION_DENIED"],
    ["provider", { code: "QUOTA_OR_API_DISABLED" }, "PROVIDER_QUOTA_OR_DISABLED"],
    ["provider", { code: "RATE_LIMITED" }, "PROVIDER_RATE_LIMITED"],
    ["provider", { code: "TIMEOUT" }, "PROVIDER_TIMEOUT"],
    ["provider", { code: "NETWORK" }, "PROVIDER_NETWORK"],
    ["job", { code: "P1001" }, "DATABASE_UNREACHABLE"],
    ["job", new Error("secret"), "JOB_FAILED"],
  ] as const)("%s classifies structured metadata only", (domain, error, expected) => {
    expect(classifyError(error, domain)).toBe(expected);
  });

  it("never examines message, stack, cause, headers or connection data", () => {
    const error = { code: "untrusted-secret", get message() { throw Error("must not read"); },
      get stack() { throw Error("must not read"); }, get cause() { throw Error("must not read"); } };
    for (const domain of ["discord", "postgres", "provider", "job"] as const) {
      expect(ERROR_CODES).toContain(classifyError(error, domain));
      expect(classifyError(error, domain)).not.toContain("secret");
      expect(classifyError(new Proxy({}, { get() { throw Error("secret"); } }), domain)).not.toContain("secret");
      for (const input of [null, undefined, "postgresql://secret", 42]) expect(ERROR_CODES).toContain(classifyError(input, domain));
    }
  });
});
