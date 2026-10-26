import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { resolveDashboardGuild } from "@/lib/dashboard/require-guild";

/**
 * Dashboard shell: sidebar, command bar and the active page.
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
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center border-b border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-bg)]/80 px-4 pl-16 backdrop-blur-xl md:px-6">
          <Suspense fallback={<HeaderSkeleton />}>
            <DashboardHeader />
          </Suspense>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1500px]">
            <Suspense fallback={<ContentSkeleton />}>
              <GatedContent>{children}</GatedContent>
            </Suspense>
          </div>
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

function HeaderSkeleton() {
  return (
    <div className="flex w-full items-center justify-between gap-4" aria-hidden>
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 animate-pulse rounded-lg bg-white/[0.05]" />
        <div className="h-7 w-36 animate-pulse rounded-md bg-white/[0.04]" />
      </div>
      <div className="h-8 w-28 animate-pulse rounded-full bg-white/[0.04]" />
    </div>
  );
}

function ContentSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-16 w-2/3 animate-pulse rounded-xl bg-white/[0.035]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]"
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]" />
    </div>
  );
}
