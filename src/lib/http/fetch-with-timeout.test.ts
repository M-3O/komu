import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchWithTimeout,
  isTimeoutError,
} from "./fetch-with-timeout";

/**
 * The deadline is the point of this module: a request that is accepted and
 * then never answered has to end.
 *
 * A real socket would take the whole timeout to prove it, so `fetch` is
 * replaced with one that never settles until its signal aborts. What is being
 * checked is that a signal is attached and that the rejection is recognisable
 * as a timeout rather than a generic network failure.
 */

/** A fetch that hangs until its signal is aborted, then rejects with it. */
function hangingFetch(): void {
  vi.stubGlobal(
    "fetch",
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithTimeout", () => {
  it("aborts a request that does not answer", async () => {
    hangingFetch();

    const started = Date.now();
    const error = await fetchWithTimeout(
      "https://example.test/slow",
      {},
      25,
    ).catch((reason: unknown) => reason);

    expect(isTimeoutError(error)).toBe(true);
    // Generous, but far below the default: the point is that it ended at all.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("passes the caller's init through and attaches a signal", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchSpy);

    const response = await fetchWithTimeout("https://example.test", {
      method: "POST",
    });

    expect(await response.text()).toBe("ok");

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps a caller's own signal alongside the deadline", async () => {
    hangingFetch();

    const controller = new AbortController();
    const pending = fetchWithTimeout(
      "https://example.test",
      { signal: controller.signal },
      30_000,
    ).catch((reason: unknown) => reason);

    controller.abort();

    expect(isTimeoutError(await pending)).toBe(true);
  });
});

describe("isTimeoutError", () => {
  it("recognises the two names runtimes use", () => {
    expect(isTimeoutError(new DOMException("late", "TimeoutError"))).toBe(true);
    expect(isTimeoutError(new DOMException("gone", "AbortError"))).toBe(true);
  });

  it("does not mistake anything else for a timeout", () => {
    expect(isTimeoutError(new Error("boom"))).toBe(false);
    expect(isTimeoutError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
    expect(isTimeoutError("TimeoutError")).toBe(false);
  });
});
