import { DashboardNav } from "@/components/dashboard/DashboardNav";

/**
 * Dashboard shell: fixed sidebar plus the active page.
 *
 * The sidebar is a Client Component (`usePathname`), which is fine to render
 * from a Server Component layout.
 */
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-surface)]">
        <DashboardNav />
      </aside>
      <main className="min-w-0 flex-1 p-8">{children}</main>
    </div>
  );
}