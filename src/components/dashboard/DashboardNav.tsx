"use client";

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BadgeCheck,
  Cable,
  ChevronRight,
  CircleHelp,
  Gift,
  LayoutDashboard,
  LineChart,
  Medal,
  Megaphone,
  Menu,
  Shield,
  Swords,
  TrendingUp,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { DASHBOARD_NAV } from "@/lib/dashboard/navigation";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/dashboard/streams": Cable,
  "/dashboard/alerts": Megaphone,
  "/dashboard/xp": TrendingUp,
  "/dashboard/roles": BadgeCheck,
  "/dashboard/leaderboards": BarChart3,
  "/dashboard/rewards": Gift,
  "/dashboard/challenges": Swords,
  "/dashboard/achievements": Medal,
  "/dashboard/moderation": Shield,
  "/dashboard/analytics": LineChart,
};

/**
 * Sidebar navigation.
 *
 * A Client Component for two reasons: `usePathname` marks the active link,
 * and `useState` drives the mobile drawer. On a narrow screen the sidebar is
 * a drawer behind a menu button; on desktop it is a fixed command rail.
 */
export function DashboardNav() {
  const pathname = usePathname();

  return <Drawer key={pathname} pathname={pathname} />;
}

function Drawer({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls="dashboard-nav"
          className="fixed left-4 top-3.5 z-50 flex h-9 w-9 items-center justify-center rounded-lg border border-[color:var(--color-komu-border-muted)] bg-[color:var(--color-komu-surface)] text-[color:var(--color-komu-muted)] shadow-lg md:hidden"
        >
          <span className="sr-only">Open menu</span>
          <Menu className="h-4 w-4" />
        </button>
      )}

      <aside
        id="dashboard-nav"
        className={[
          open
            ? "fixed inset-y-0 left-0 z-40 flex w-[268px] flex-col"
            : "hidden",
          "border-r border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-bg-deep)]/95 backdrop-blur-xl",
          "md:sticky md:top-0 md:flex md:h-screen md:w-[260px] md:shrink-0 md:flex-col",
        ].join(" ")}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[color:var(--color-komu-border)] px-5">
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5"
          >
            <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 via-violet-500 to-fuchsia-500 p-[2px] shadow-[0_0_34px_-6px_rgba(139,92,246,0.9)]">
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[#050505] ring-1 ring-white/15">
                <Image
                  src="/brand/komu-avatar.webp"
                  alt=""
                  width={104}
                  height={104}
                  sizes="52px"
                  className="h-full w-full rounded-full object-cover"
                />
              </span>
            </span>
            <span className="font-display text-lg font-bold tracking-[-0.03em] text-[color:var(--color-komu-text)]">
              Komu
            </span>
            <span className="komu-chip komu-chip-accent px-1.5 py-0.5 text-[9px]">
              Beta
            </span>
          </Link>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--color-komu-muted)] hover:bg-white/[0.04] md:hidden"
          >
            <span className="sr-only">Close menu</span>
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="komu-scroll-area min-h-0 flex-1 px-3 py-5">
          <div className="flex flex-col gap-6">
            {DASHBOARD_NAV.map((section) => (
              <div key={section.title}>
                <p className="komu-label px-2 pb-2 text-[10px]">{section.title}</p>
                <ul className="flex flex-col gap-1">
                  {section.items.map((item) => {
                    const isActive =
                      item.href === "/dashboard"
                        ? pathname === item.href
                        : pathname.startsWith(item.href);
                    const Icon = NAV_ICONS[item.href] ?? LayoutDashboard;

                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={isActive ? "page" : undefined}
                          onClick={() => setOpen(false)}
                          className={[
                            "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition",
                            isActive
                              ? "bg-white/[0.055] font-medium text-[color:var(--color-komu-text)] shadow-[inset_2px_0_0_#6366f1]"
                              : "text-[color:var(--color-komu-muted)] hover:bg-white/[0.035] hover:text-[color:var(--color-komu-text)]",
                          ].join(" ")}
                        >
                          <Icon
                            className={[
                              "h-4 w-4 shrink-0 transition",
                              isActive
                                ? "text-indigo-300"
                                : "text-[color:var(--color-komu-dim)] group-hover:text-[color:var(--color-komu-muted)]",
                            ].join(" ")}
                            strokeWidth={1.8}
                          />
                          <span className="truncate">{item.label}</span>
                          {isActive ? (
                            <ChevronRight className="ml-auto h-3.5 w-3.5 text-indigo-300/70" />
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="shrink-0 border-t border-[color:var(--color-komu-border)] p-3">
          <div className="rounded-xl border border-[color:var(--color-komu-border)] bg-white/[0.02] p-3">
            <div className="flex items-center gap-2">
              <span className="komu-live-dot" />
              <p className="komu-label text-[9px] text-emerald-300">Discord connected</p>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-[color:var(--color-komu-muted)]">
              Alerts are dispatched by the Komu app. The bot adds slash commands
              and reaction attendance.
            </p>
            <Link
              href="/dashboard/alerts"
              onClick={() => setOpen(false)}
              className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-300 hover:text-indigo-200"
            >
              <CircleHelp className="h-3 w-3" />
              Alert routing
            </Link>
          </div>
        </div>
      </aside>

      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/65 backdrop-blur-sm md:hidden"
        />
      ) : null}
    </>
  );
}
