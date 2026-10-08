import { Suspense } from "react";

import { getAuthSecret } from "@/lib/config/server-config";

export const metadata = { title: "Sign in" };

/** Human-readable explanations for the codes the callback can redirect with. */
const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: "Discord sign-in was cancelled. Please try again.",
  state_mismatch:
    "That sign-in link expired or could not be verified. Please try again.",
  login_failed:
    "We could not complete sign-in with Discord. Please try again in a moment.",
  not_configured:
    "Discord sign-in is not configured yet. Add your Discord credentials to .env.local and restart the app.",
};

/**
 * Sign-in screen.
 *
 * The shell is static; the button and any error message are read inside a
 * `<Suspense>` boundary because the return destination is only known at
 * request time under Cache Components.
 */
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] p-8">
        <h1 className="text-2xl font-bold tracking-tight">Sign in to Komu</h1>
        <p className="mt-2 text-sm text-[color:var(--color-komu-muted)]">
          Use your Discord account to manage your community.
        </p>

        <Suspense fallback={<div className="mt-6 h-11" />}>
          <LoginPanel searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function LoginPanel({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = firstValue(params.returnTo) ?? "/dashboard";
  const errorCode = firstValue(params.error);
  const error = errorCode ? ERROR_MESSAGES[errorCode] : undefined;

  const isConfigured = getAuthSecret() !== null;

  return (
    <div className="mt-6 flex flex-col gap-4">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--color-komu-live)] bg-[color:var(--color-komu-live)]/10 p-3 text-sm text-[color:var(--color-komu-live)]"
        >
          {error}
        </p>
      ) : null}

      {isConfigured ? (
        <a
          href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
          className="rounded-lg bg-[color:var(--color-komu-accent)] px-5 py-2.5 text-center font-medium text-white transition hover:bg-[color:var(--color-komu-accent-hover)]"
        >
          Continue with Discord
        </a>
      ) : (
        <p className="rounded-md border border-[color:var(--color-komu-border)] p-3 text-sm text-[color:var(--color-komu-muted)]">
          Set{" "}
          <code className="text-[color:var(--color-komu-text)]">
            AUTH_SECRET
          </code>{" "}
          in{" "}
          <code className="text-[color:var(--color-komu-text)]">.env.local</code>{" "}
          to enable sign-in.
        </p>
      )}
    </div>
  );
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}