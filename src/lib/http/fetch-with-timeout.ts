import "server-only";

/**
 * A deadline for outbound requests.
 *
 * None of the services Komu calls promises to answer. A connection that is
 * accepted and then goes quiet is the failure that hurts: without a deadline
 * the caller waits forever, a poll cycle never finishes, and the next tick
 * starts on top of it. For YouTube that is 101 quota units per stacked search
 * until the daily allowance is gone.
 *
 * `AbortSignal.timeout` covers the whole exchange, including reading the body,
 * because the signal stays attached to the response object.
 */

/** Long enough for a slow API, short enough to fail before a poll interval. */
export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<Response> {
  // A caller that brought its own signal keeps it: the deadline is the
  // earlier of the two, not a replacement.
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);

  return fetch(url, { ...init, signal });
}

/**
 * Whether a rejection was the deadline rather than a network failure.
 *
 * undici reports an `AbortSignal.timeout` abort as a DOMException named
 * `TimeoutError`; some runtimes use `AbortError`. The name is read rather than
 * `instanceof` because a DOMException is not an Error in every runtime.
 */
export function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const name = (error as { name?: unknown }).name;

  return name === "TimeoutError" || name === "AbortError";
}
