"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { DASHBOARD_NAV } from "@/lib/dashboard/navigation";

/**
 * Sidebar navigation.
 *
 * A Client Component because `usePathname` is needed to mark the active
 * link, and layouts cannot read the pathname themselves (Next.js App Router).
 */
export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-6 p-4" aria-label="Dashboard">
      <div className="px-2">
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
    </nav>
  );
}