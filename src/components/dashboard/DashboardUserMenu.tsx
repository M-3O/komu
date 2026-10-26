import { LogOut } from "lucide-react";

import { initials } from "@/components/dashboard/ui";

/**
 * Username and sign-out, shown in the dashboard header.
 *
 * Sign-out is a POST form pointing at the logout route, so another site
 * cannot force a visitor to log out by sending them to a URL.
 */
export function DashboardUserMenu({
  username,
  avatarUrl,
}: {
  username: string;
  avatarUrl: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 rounded-full border border-[color:var(--color-komu-border-muted)] object-cover"
        />
      ) : (
        <span className="komu-avatar h-8 w-8 text-[11px]" aria-hidden>
          {initials(username)}
        </span>
      )}

      <span className="hidden min-w-0 flex-col sm:flex">
        <span className="truncate text-xs font-semibold text-[color:var(--color-komu-text)]">
          {username}
        </span>
        <span className="text-[10px] text-[color:var(--color-komu-dim)]">
          Server administrator
        </span>
      </span>

      <form action="/logout" method="post">
        <button
          type="submit"
          className="ml-1 flex h-8 items-center gap-1.5 rounded-lg border border-transparent px-2 text-[color:var(--color-komu-muted)] transition hover:border-[color:var(--color-komu-border-muted)] hover:bg-white/[0.03] hover:text-[color:var(--color-komu-text)]"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
          <span className="sr-only sm:not-sr-only sm:text-[11px]">Sign out</span>
        </button>
      </form>
    </div>
  );
}
