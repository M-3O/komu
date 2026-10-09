"use client";

import { useEffect } from "react";

import { createLogger } from "@/lib/logger";

/**
 * The root error boundary.
 *
 * Catches anything the dashboard boundary does not, so a failure always shows
 * the same shape rather than Next.js's built-in page. Kept deliberately plain:
 * at this level there is no session to read and no safe navigation to offer,
 * so reloading is the only honest action.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    createLogger("server").error("Unhandled application error", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 p-8 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Komu hit a problem</h1>

      <p className="max-w-md text-sm text-[color:var(--color-komu-muted)]">
        This is usually temporary. Reloading the page will usually clear it. If
        it keeps happening, the server logs will have the details.
      </p>

      {error.message ? (
        <p className="max-w-md rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-3 font-mono text-xs">
          {error.message}
        </p>
      ) : null}

      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-[color:var(--color-komu-accent)] px-5 py-2 font-medium text-white transition hover:bg-[color:var(--color-komu-accent-hover)]"
      >
        Reload
      </button>
    </main>
  );
}