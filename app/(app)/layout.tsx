import { Suspense } from "react"
import { redirect } from "next/navigation"
import { AppSidebarSection, AppSidebarSkeleton } from "@/components/app-sidebar-section"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { ImpersonationBanner } from "@/components/impersonation-banner"
import { DeletionBanner } from "@/components/deletion-banner"
import { TenantProvider } from "@/components/tenant-provider"
import { PreferencesProvider } from "@/components/preferences-provider"
import { OfflineSyncProvider } from "@/components/offline-sync-provider"
import { PrintProvider } from "@/components/print/print-provider"
import { AutoPrintWorkerMount } from "@/components/print/auto-print-worker-mount"
import { RealtimeAuth } from "@/components/realtime-auth"
import { NewOrderProvider } from "@/components/pos/new-order-provider"
import { getActiveTenant } from "@/lib/supabase/tenant"
import { getUserPreferences } from "@/lib/supabase/preferences"
import { getCurrentUser } from "@/lib/supabase/user"

/**
 * Shared shell for all authenticated staff pages: sidebar + header. Auth is
 * enforced once here (proxy also guards) so every page inside renders inside
 * the same chrome. Public routes (login, /t, /s, /book, receipt) live outside
 * this route group and get no sidebar.
 *
 * Only what gates or themes the whole page is awaited here — the user (redirect
 * to /login), the tenant (redirect to /onboarding) and preferences (theme, or
 * the page paints in the wrong one). Sidebar data and the print worker's config
 * stream behind their own boundaries so the page body is not held up by reads
 * it does not use.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  // Neither read depends on the other, so they go together rather than serially.
  const [tenant, prefs] = await Promise.all([getActiveTenant(), getUserPreferences()])
  if (!tenant) redirect("/onboarding")

  const fallbackName =
    (user.user_metadata?.restaurant_name as string) ?? user.email?.split("@")[0] ?? "User"

  return (
    <TenantProvider tenant={tenant}>
      <PreferencesProvider initialTheme={prefs.theme} initialScale={prefs.scale}>
      <OfflineSyncProvider>
      <PrintProvider>
      <Suspense fallback={null}>
        <AutoPrintWorkerMount tenantId={tenant.tenantId} />
      </Suspense>
      <RealtimeAuth />
      {/* Above the sidebar, so the New order button can reach it — and outside
          SidebarInset, so the composer isn't nested in the page it opens over. */}
      <NewOrderProvider>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        <Suspense fallback={<AppSidebarSkeleton />}>
          <AppSidebarSection
            tenant={tenant}
            userEmail={user.email ?? ""}
            fallbackName={fallbackName}
          />
        </Suspense>
        <SidebarInset>
          {tenant.impersonating ? <ImpersonationBanner name={tenant.name} /> : null}
          <SiteHeader />
          {/* Below the header, above the page — a page-level warning, not app chrome. */}
          {tenant.deletionScheduledAt ? (
            <DeletionBanner
              scheduledAt={tenant.deletionScheduledAt}
              timezone={tenant.timezone}
              isOwner={tenant.role === "owner"}
            />
          ) : null}
          {children}
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
      </NewOrderProvider>
      </PrintProvider>
      </OfflineSyncProvider>
      </PreferencesProvider>
    </TenantProvider>
  )
}
