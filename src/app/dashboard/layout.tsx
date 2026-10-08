import { Suspense } from "react";

import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { DashboardUserMenu } from "@/components/dashboard/DashboardUserMenu";
import { requireCurrentUser } from "@/lib/auth/current-user";

/**
 * Dashboard shell: sidebar, header and the active page.
 *
 * `requireCurrentUser` runs here so the whole dashboard is protected in one
 * place. It reads the session cookie, which is request-time data, so the
 * header that depends on it is streamed from inside `<Suspense>`.
 */
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]">
        <DashboardNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end border-b border-[color:var(--color-komu-border)] px-8 py-3">
          <Suspense fallback={<div className="h-8 w-24" />}>
            <CurrentUserHeader />
          </Suspense>
        </header>

        <main className="min-w-0 flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}

async function CurrentUserHeader() {
  const user = await requireCurrentUser();

  return <DashboardUserMenu username={user.username} avatarUrl={user.avatarUrl} />;
}