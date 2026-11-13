import { describe, expect, it } from "vitest";

import { isValidRedirectUri } from "./config";

describe("TikTok OAuth configuration validation", () => {
  it("requires an exact, trimmed HTTPS redirect URI shorter than 512 bytes", () => {
    expect(isValidRedirectUri("https://komu.example/callback")).toBe(true);
    expect(isValidRedirectUri(" https://komu.example/callback")).toBe(false);
    expect(isValidRedirectUri("https://komu.example/callback ")).toBe(false);
    expect(isValidRedirectUri("http://komu.example/callback")).toBe(false);
    expect(isValidRedirectUri("https://komu.example/callback?state=1")).toBe(false);
    expect(isValidRedirectUri("https://komu.example/callback#fragment")).toBe(false);
    expect(isValidRedirectUri(`https://komu.example/${"a".repeat(500)}`)).toBe(false);
  });
});
