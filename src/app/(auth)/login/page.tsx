import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { getAuthSecret } from "@/lib/config/server-config";
import {
  DOCUMENTATION_URL,
  SECURITY_URL,
  SOURCE_URL,
  SUPPORT_URL,
} from "@/lib/site-links";

export const metadata = {
  title: "Sign in",
  description: "Sign in to Komu with Discord.",
};

/** Human-readable explanations for the codes the callback can redirect with. */
const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: "Discord sign-in was cancelled. Please try again.",
  state_mismatch:
    "That sign-in link expired or could not be verified. Please try again.",
  login_failed:
    "We could not complete sign-in with Discord. Please try again in a moment.",
  rate_limited: "Too many sign-in attempts. Wait a minute and try again.",
  not_configured:
    "Discord sign-in is not configured yet. Add your Discord credentials to the server environment and restart the app.",
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
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#080b11] text-slate-200 selection:bg-indigo-500 selection:text-white">
      <AmbientBackground />

      <header className="relative z-10 w-full border-b border-white/[0.05] bg-[#080b11]/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="group flex items-center gap-3 transition-opacity hover:opacity-95"
          >
            <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-400 via-indigo-500 to-purple-400 p-px shadow-md shadow-emerald-500/20 transition-all group-hover:shadow-emerald-500/40">
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[#050505]">
                <Image
                  src="/brand/komu-logo.webp"
                  alt=""
                  width={64}
                  height={64}
                  className="h-full w-full rounded-full object-cover transition-transform duration-300 group-hover:scale-110"
                />
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full border border-[#080b11] bg-emerald-400" />
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="font-display text-xl font-bold tracking-tight text-white">
                Komu
              </span>
              <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                Suite
              </span>
            </span>
          </Link>

          <nav className="flex items-center gap-3 text-sm sm:gap-6">
            <a
              href={DOCUMENTATION_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden font-medium text-slate-400 transition-colors hover:text-white sm:inline"
            >
              Documentation
            </a>
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden font-medium text-slate-400 transition-colors hover:text-white sm:inline"
            >
              Support
            </a>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 shadow-sm shadow-emerald-500/10">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              <span>Discord OAuth</span>
            </span>
          </nav>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
        <div className="mx-auto flex w-full max-w-md flex-col items-center">
          <div className="relative w-full">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-1.5 rounded-3xl bg-gradient-to-b from-emerald-500/25 via-indigo-600/20 to-purple-600/5 opacity-80 blur-2xl"
            />

            <section className="relative w-full rounded-2xl border border-white/[0.09] bg-[#0f1420]/95 p-7 shadow-2xl shadow-black/50 backdrop-blur-2xl sm:p-9">
              <div className="mb-7 flex flex-col items-center pt-2 text-center">
                <div className="group relative mb-6 flex items-center justify-center">
                  <div
                    aria-hidden
                    className="komu-auth-radiance pointer-events-none absolute -inset-8 rounded-full bg-gradient-to-r from-purple-600/40 via-fuchsia-600/35 to-indigo-600/40 opacity-90 blur-2xl"
                  />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -inset-3 rounded-full bg-purple-500/30 blur-lg"
                  />
                  <div
                    aria-hidden
                    className="komu-auth-ring pointer-events-none absolute -inset-1.5 rounded-full border border-purple-400/40"
                  />

                  <div className="relative flex h-[88px] w-[88px] items-center justify-center rounded-full bg-gradient-to-tr from-purple-600 via-fuchsia-400 to-indigo-500 p-[2px] shadow-[0_0_35px_-5px_rgba(168,85,247,0.65),0_0_70px_-10px_rgba(147,51,234,0.45),inset_0_0_15px_rgba(192,132,252,0.3)] transition-all duration-300 group-hover:scale-105">
                    <div className="relative h-full w-full overflow-hidden rounded-full border border-purple-400/30 bg-[#050505] p-[2px] shadow-inner">
                      <Image
                        src="/brand/komu-logo.webp"
                        alt="Komu logo"
                        width={256}
                        height={256}
                        sizes="84px"
                        priority
                        className="h-full w-full rounded-full object-cover transition-transform duration-300 group-hover:scale-110"
                      />
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-purple-300/[0.08] to-white/15"
                      />
                    </div>
                  </div>

                  <span className="absolute -bottom-0.5 -right-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-[#0f1420] bg-emerald-400" />
                  </span>
                </div>

                <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  Sign in to Komu
                </h1>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-400">
                  Connect your Discord account to manage live alerts, community
                  progression, and creator rewards.
                </p>
              </div>

              <Suspense fallback={<LoginPanelSkeleton />}>
                <LoginPanel searchParams={searchParams} />
              </Suspense>

              <div className="relative my-7">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/[0.07]" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-[#0f1420] px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Security &amp; privacy
                  </span>
                </div>
              </div>

              <SecurityNotes />
            </section>
          </div>

          <FeatureTags />
        </div>
      </main>

      <footer className="relative z-10 w-full border-t border-white/[0.05] bg-[#080b11]/80 py-6 text-xs text-slate-500 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-4 px-4 text-center sm:flex-row sm:px-6 sm:text-left lg:px-8">
          <p>
            © 2026 Komu <span className="px-1">•</span> Not affiliated with
            Discord Inc.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <FooterLink href={DOCUMENTATION_URL}>Documentation</FooterLink>
            <FooterLink href={SUPPORT_URL}>Support</FooterLink>
            <FooterLink href={SECURITY_URL}>Security</FooterLink>
            <FooterLink href={SOURCE_URL}>Source</FooterLink>
          </div>
        </div>
      </footer>
    </div>
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
    <div className="space-y-3.5">
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-400/25 bg-red-500/[0.07] p-3 text-sm leading-5 text-red-200"
        >
          {error}
        </p>
      ) : null}

      {isConfigured ? (
        <a
          href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
          aria-label="Continue with Discord"
          className="komu-auth-sheen group relative flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-[#5865F2] px-5 py-3.5 text-sm font-semibold tracking-wide text-white shadow-lg shadow-indigo-600/35 transition-all duration-200 hover:bg-[#4752C4] hover:shadow-indigo-500/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1420] active:scale-[0.98]"
        >
          <DiscordIcon className="h-5 w-5 fill-current drop-shadow transition-transform group-hover:scale-110" />
          <span>Continue with Discord</span>
          <ArrowRight
            className="ml-0.5 h-4 w-4 text-indigo-200 transition-transform group-hover:translate-x-1"
            strokeWidth={2.2}
          />
        </a>
      ) : (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3.5 text-sm leading-6 text-amber-100/80">
          <p className="font-medium text-amber-200">Sign-in is not configured.</p>
          <p className="mt-1 text-xs leading-5">
            Add{" "}
            <code className="rounded bg-black/25 px-1 py-0.5 text-amber-100">
              AUTH_SECRET
            </code>{" "}
            to the server environment and restart the app to enable Discord
            sign-in.
          </p>
        </div>
      )}

      <p className="pt-1 text-center text-[12px] leading-5 text-slate-500">
        Owner or administrator access to the connected Discord server is
        required.
      </p>
    </div>
  );
}

function LoginPanelSkeleton() {
  return (
    <div className="space-y-3.5" aria-hidden>
      <div className="h-[52px] animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03]" />
      <div className="mx-auto h-3 w-2/3 rounded bg-white/[0.03]" />
    </div>
  );
}

function SecurityNotes() {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5 transition-colors hover:border-emerald-500/30">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-400">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="text-xs">
          <p className="font-medium text-slate-200">Secure Discord OAuth</p>
          <p className="text-[11px] leading-4 text-slate-400">
            Sign-in happens on Discord. Your password never reaches Komu.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5 transition-colors hover:border-indigo-500/30">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-indigo-500/25 bg-indigo-500/10 text-indigo-400">
          <LockKeyhole className="h-4 w-4" />
        </div>
        <div className="text-xs">
          <p className="font-medium text-slate-200">Server-scoped access</p>
          <p className="text-[11px] leading-4 text-slate-400">
            Only the connected server&apos;s owner or admins can open the
            dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}

function FeatureTags() {
  const features = [
    {
      label: "Twitch, YT & Kick",
      dot: "bg-emerald-400 shadow-emerald-400/50",
      hover: "hover:border-emerald-500/30",
    },
    {
      label: "Automated XP & Roles",
      dot: "bg-indigo-400 shadow-indigo-400/50",
      hover: "hover:border-indigo-500/30",
    },
    {
      label: "Anti-Raid Shield",
      dot: "bg-violet-400 shadow-violet-400/50",
      hover: "hover:border-violet-500/30",
    },
  ];

  return (
    <div className="mt-8 grid w-full grid-cols-1 gap-2.5 text-center text-xs sm:grid-cols-3">
      {features.map((feature) => (
        <div
          key={feature.label}
          className={`flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-slate-400 transition-all hover:text-slate-300 ${feature.hover}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full shadow-sm ${feature.dot}`}
          />
          <span>{feature.label}</span>
        </div>
      ))}
    </div>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="transition-colors hover:text-slate-300"
    >
      {children}
    </a>
  );
}

function AmbientBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="komu-auth-grid absolute inset-0 opacity-70" />
      <div className="komu-auth-pulse absolute -top-32 left-1/2 h-[540px] w-[760px] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[130px]" />
      <div className="absolute left-1/2 top-20 h-[260px] w-[420px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-[100px]" />
      <div className="absolute -bottom-40 left-1/3 h-[400px] w-[580px] rounded-full bg-violet-700/10 blur-[140px]" />
      <div className="komu-auth-ambient absolute inset-0" />
    </div>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 127.14 96.36"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z" />
    </svg>
  );
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
