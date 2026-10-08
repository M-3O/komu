import { describe, expect, it } from "vitest";

import { MAX_TIMEOUT_MS, MIN_TIMEOUT_MS, clampTimeoutMs } from "./timeout";

describe("clampTimeoutMs", () => {
  it("leaves a valid duration alone", () => {
    expect(clampTimeoutMs(60_000)).toBe(60_000);
  });

  it("caps at Discord's 28 day maximum", () => {
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(clampTimeoutMs(thirtyDays)).toBe(MAX_TIMEOUT_MS);
  });

  it("raises a zero or negative duration to the minimum", () => {
    expect(clampTimeoutMs(0)).toBe(MIN_TIMEOUT_MS);
    expect(clampTimeoutMs(-5000)).toBe(MIN_TIMEOUT_MS);
  });

  it("caps a very large duration", () => {
    expect(clampTimeoutMs(Number.MAX_SAFE_INTEGER)).toBe(MAX_TIMEOUT_MS);
  });

  it("caps exactly 28 days without change", () => {
    expect(clampTimeoutMs(MAX_TIMEOUT_MS)).toBe(MAX_TIMEOUT_MS);
  });

  it("handles NaN without propagating it", () => {
    expect(Number.isFinite(clampTimeoutMs(Number.NaN))).toBe(true);
  });
});