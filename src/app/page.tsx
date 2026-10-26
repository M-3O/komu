import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  DOCUMENTATION_URL,
  SECURITY_URL,
  SOURCE_URL,
  SUPPORT_URL,
} from "@/lib/site-links";

export const metadata = {
  title: { absolute: "Komu — Stream to Discord Hub" },
  description:
    "Connect your streaming channels to Discord and turn your community into an active one.",
};

const PLATFORMS = ["Twitch", "YouTube", "Kick", "Discord"];

const FEATURES = [
  {
    icon: "⚡",
    title: "Stream Alerts",
    description: "Automatic go-live alerts across Twitch, YouTube, and Kick",
  },
  {
    icon: "🏆",
    title: "Automated XP & Levels",
    description: "Message and stream activity with custom Discord perks",
  },
  {
    icon: "🛡️",
    title: "Anti-Raid Shield",
    description: "Raid detection, spam filtering, and moderator tools",
  },
];

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#07090e] font-sans text-slate-100 selection:bg-indigo-500 selection:text-white">
      <HomeBackground />

      <header className="relative z-10 w-full border-b border-slate-800/60 bg-[#07090e]/70 px-6 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link
            href="/"
            className="group flex items-center gap-3.5 transition-opacity hover:opacity-95"
          >
            <span className="relative h-9 w-9 overflow-hidden rounded-full bg-[#050505] p-0.5 shadow-md ring-2 ring-indigo-500/50">
              <Image
                src="/brand/komu-logo.webp"
                alt=""
                width={64}
                height={64}
                className="h-full w-full rounded-full object-cover"
              />
            </span>
            <span className="flex items-baseline gap-2">
              <span className="font-display text-xl font-bold tracking-tight text-white">
                Komu
              </span>
              <span className="inline-flex items-center rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                Suite
              </span>
            </span>
          </Link>

          <nav
            aria-label="Global navigation"
            className="flex items-center gap-3 text-sm sm:gap-6"
          >
            <a
              href={DOCUMENTATION_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden font-medium text-slate-400 transition-colors hover:text-slate-100 md:inline"
            >
              Documentation
            </a>
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden font-medium text-slate-400 transition-colors hover:text-slate-100 md:inline"
            >
              Support
            </a>
            <span className="hidden items-center gap-2 rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1 text-xs text-slate-300 sm:flex">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              <span>Discord OAuth</span>
            </span>
          </nav>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-12">
        <div className="flex w-full max-w-xl flex-col items-center text-center">
          <div className="relative mb-7">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-1.5 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 opacity-60 blur-md"
            />
            <div className="komu-home-avatar relative h-28 w-28 overflow-hidden rounded-full bg-[#050505] ring-2 ring-indigo-500/60 sm:h-32 sm:w-32">
              <Image
                src="/brand/komu-logo.webp"
                alt="Komu logo"
                width={512}
                height={512}
                sizes="(max-width: 640px) 112px, 128px"
                priority
                className="h-full w-full rounded-full object-cover"
              />
            </div>
          </div>

          <h1 className="mb-3 font-display text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Komu
          </h1>
          <p className="mx-auto mb-7 max-w-md text-base leading-relaxed text-slate-300 sm:text-lg">
            Connect your streaming channels to Discord and turn your community
            into an active one.
          </p>

          <div className="flex w-full flex-col items-center gap-3">
            <Link
              href="/dashboard"
              className="komu-home-glow group inline-flex items-center justify-center gap-2.5 rounded-xl bg-indigo-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg transition-all hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07090e] active:scale-[0.98]"
            >
              <span>Open dashboard</span>
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                strokeWidth={2.5}
              />
            </Link>
            <p className="mt-2 text-xs text-slate-500">
              Requires owner or administrator access to the Discord server.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <span className="mr-1 text-xs text-slate-500">
              Integrates with:
            </span>
            {PLATFORMS.map((platform) => (
              <span
                key={platform}
                className="rounded-md border border-slate-800 bg-slate-900/90 px-2.5 py-1 text-xs text-slate-400"
              >
                {platform}
              </span>
            ))}
          </div>
        </div>
      </main>

      <section
        aria-label="Key features"
        className="relative z-10 mx-auto w-full max-w-5xl px-6 py-6"
      >
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="flex items-center gap-3 rounded-xl border border-slate-800/80 bg-[#0b0e17]/60 p-3.5 backdrop-blur-sm"
            >
              <span aria-hidden className="text-lg">
                {feature.icon}
              </span>
              <div>
                <h2 className="text-xs font-semibold text-slate-200">
                  {feature.title}
                </h2>
                <p className="text-[11px] leading-4 text-slate-400">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative z-10 border-t border-slate-800/60 bg-[#07090e] px-6 py-5 text-xs text-slate-500">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 sm:flex-row">
          <p>
            © 2026 Komu <span className="px-1">•</span> Not affiliated with
            Discord Inc.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
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

function HomeBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="komu-home-grid absolute inset-0 opacity-40" />
      <div className="absolute left-1/2 top-1/4 h-[650px] w-[650px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-indigo-900/25 via-purple-900/20 to-transparent blur-3xl" />
    </div>
  );
}
