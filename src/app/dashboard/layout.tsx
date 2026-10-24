import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { DashboardUserMenu } from "@/components/dashboard/DashboardUserMenu";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { resolveDashboardGuild } from "@/lib/dashboard/require-guild";

/**
 * Dashboard shell: sidebar, header and the active page.
 *
 * The page content is gated so a signed-in visitor who cannot administer the
 * connected server is sent to `/setup`, where the reason is explained. That
 * is defence in depth rather than the boundary itself: a Server Action can be
 * invoked without rendering this layout, so every action checks again.
 *
 * Both the gate and the header read the session cookie, which is request-time
 * data. Rendering that outside `<Suspense>` makes the route impossible to
 * prerender, so each sits behind its own boundary and the shell still streams.
 */
export default function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-screen">
      <DashboardNav />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Padding on the left clears the mobile menu button. */}
        <header className="flex items-center justify-end border-b border-[color:var(--color-komu-border)] px-8 py-3 pl-16 md:pl-8">
          <Suspense fallback={<div className="h-8 w-24" />}>
            <CurrentUserHeader />
          </Suspense>
        </header>

        <main className="min-w-0 flex-1 p-4 pt-16 md:p-8 md:pt-8">
          <Suspense fallback={<ContentSkeleton />}>
            <GatedContent>{children}</GatedContent>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

async function GatedContent({ children }: { children: ReactNode }) {
  const access = await resolveDashboardGuild("/dashboard");

  if (!access.ok) redirect("/setup");

  return <>{children}</>;
}

async function CurrentUserHeader() {
  const user = await requireCurrentUser();

  return <DashboardUserMenu username={user.username} avatarUrl={user.avatarUrl} />;
}

function ContentSkeleton() {
  return (
    <div
      className="h-64 animate-pulse rounded-xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
      aria-hidden
    />
  );
}
