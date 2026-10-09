"use client";

import { useEffect } from "react";

import { createLogger } from "@/lib/logger";

/**
 * The dashboard's error boundary.
 *
 * Without this, any thrown error during rendering or a data load leaves the
 * creator staring at a blank page with no way back and no idea what happened.
 * A creator who cannot see a failure has no way to report it usefully.
 *
 * `error.tsx` must be a Client Component: Next.js hands it the error and a
 * reset callback, and it is rendered in place of the page that failed.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const scope = "server";

  useEffect(() => {
    createLogger(scope).error("Dashboard page failed", {
      message: error.message,
      // The digest is what correlates this with the server log.
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-[color:var(--color-komu-live)] bg-[color:var(--color-komu-live)]/10 p-6">
        <h1 className="text-lg font-semibold text-[color:var(--color-komu-live)]">
          Something went wrong on this page
        </h1>

        <p className="mt-2 text-sm">
          The rest of the dashboard still works. Try again, and if it keeps
          failing, check the server logs.
        </p>

        {error.message ? (
          <p className="mt-3 rounded-md bg-[color:var(--color-komu-surface)] p-3 font-mono text-xs">
            {error.message}
          </p>
        ) : null}

        {error.digest ? (
          <p className="mt-2 text-xs text-[color:var(--color-komu-muted)]">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-[color:var(--color-komu-accent)] px-5 py-2 font-medium text-white transition hover:bg-[color:var(--color-komu-accent-hover)]"
        >
          Try again
        </button>

        <a
          href="/dashboard"
          className="rounded-lg border border-[color:var(--color-komu-border)] px-5 py-2 font-medium transition hover:bg-[color:var(--color-komu-surface)]"
        >
          Back to overview
        </a>
      </div>
    </div>
  );
}