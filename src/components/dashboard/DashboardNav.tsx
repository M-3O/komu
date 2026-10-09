"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { DASHBOARD_NAV } from "@/lib/dashboard/navigation";

/**
 * Sidebar navigation.
 *
 * A Client Component for two reasons: `usePathname` marks the active link,
 * and `useState` drives the mobile drawer. Neither can be read in a layout.
 *
 * On a narrow screen the sidebar is a drawer behind a menu button, because a
 * permanently visible 240px column leaves no room for the page itself on a
 * phone. The drawer closes on navigation, so tapping a link does not leave it
 * covering the page you just asked for.
 */
export function DashboardNav() {
  const pathname = usePathname();

  // Keying on the pathname remounts the drawer on every navigation, so it
  // starts closed without an effect. An effect calling setState would trigger
  // a cascading render, and the links already close the drawer directly.
  return <Drawer key={pathname} pathname={pathname} />;
}

function Drawer({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Only on narrow screens, where the sidebar is hidden. */}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="dashboard-nav"
        className="fixed top-3 left-3 z-30 rounded-md border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)] px-3 py-2 text-sm md:hidden"
      >
        {open ? "Close" : "Menu"}
      </button>

      <aside
        className={[
          // The drawer on narrow screens, a static column from md up.
          open ? "fixed inset-y-0 left-0 z-20 w-60" : "hidden",
          "border-r border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]",
          "md:static md:block md:w-60 md:shrink-0",
        ].join(" ")}
      >
        <div id="dashboard-nav" className="flex flex-col gap-6 p-4">
          <div className="px-2 pt-10 md:pt-0">
            <p className="text-lg font-bold tracking-tight">Komu</p>
          </div>

          {DASHBOARD_NAV.map((section) => (
            <div key={section.title}>
              <p className="px-2 pb-2 text-xs font-semibold tracking-wider text-[color:var(--color-komu-muted)] uppercase">
                {section.title}
              </p>
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const isActive =
                    item.href === "/dashboard"
                      ? pathname === item.href
                      : pathname.startsWith(item.href);

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        className={[
                          "block rounded-md px-2 py-1.5 text-sm transition",
                          isActive
                            ? "bg-[color:var(--color-komu-surface-raised)] font-medium text-white"
                            : "text-[color:var(--color-komu-muted)] hover:bg-[color:var(--color-komu-surface)] hover:text-[color:var(--color-komu-text)]",
                        ].join(" ")}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      {/* Dim the page behind the drawer, and let a tap outside close it. */}
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-10 bg-black/50 md:hidden"
        />
      ) : null}
    </>
  );
}