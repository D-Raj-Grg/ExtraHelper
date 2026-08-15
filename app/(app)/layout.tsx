import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { ImpersonationBanner } from "@/components/impersonation-banner"
import { DeletionBanner } from "@/components/deletion-banner"
import { TenantProvider } from "@/components/tenant-provider"
import { PreferencesProvider } from "@/components/preferences-provider"
import { OfflineSyncProvider } from "@/components/offline-sync-provider"
import { PrintProvider } from "@/components/print/print-provider"
import { AutoPrintWorker } from "@/components/print/auto-print-worker"
import { RealtimeAuth } from "@/components/realtime-auth"
import { NewOrderProvider } from "@/components/pos/new-order-provider"
import { createClient } from "@/lib/supabase/server"
import { getActiveTenant, getTenantMemberships } from "@/lib/supabase/tenant"
import { getUserPreferences } from "@/lib/supabase/preferences"
import { getMyPermissions } from "@/lib/supabase/permissions"
import { getProfile } from "@/lib/supabase/profile"
import { PermissionProvider } from "@/components/permission-provider"

/**
 * Shared shell for all authenticated staff pages: sidebar + header. Auth is
 * enforced once here (proxy also guards) so every page inside renders inside
 * the same chrome. Public routes (login, /t, /s, /book, receipt) live outside
 * this route group and get no sidebar.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const tenant = await getActiveTenant()
  if (!tenant) redirect("/onboarding")

  const [prefs, memberships, permissions, profile, settings] = await Promise.all([
    getUserPreferences(),
    getTenantMemberships(),
    getMyPermissions(tenant.tenantId),
    getProfile(),
    supabase
      .from("tenant_settings")
      .select("printing_mode")
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle(),
  ])

  // In cloud mode the headless agent owns the print queue and browsers stay
  // out of it, so the worker is not mounted at all.
  const printingMode = settings.data?.printing_mode === "cloud" ? "cloud" : "local"

  const sidebarUser = {
    name:
      profile?.fullName ??
      (user.user_metadata?.restaurant_name as string) ??
      user.email?.split("@")[0] ??
      "User",
    email: user.email ?? "",
    avatar: profile?.avatarUrl ?? "",
  }

  return (
    <TenantProvider tenant={tenant}>
      <PreferencesProvider initialTheme={prefs.theme} initialScale={prefs.scale}>
      <PermissionProvider permissions={permissions}>
      <OfflineSyncProvider>
      <PrintProvider>
      <AutoPrintWorker tenantId={tenant.tenantId} branchId={null} mode={printingMode} />
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
        <AppSidebar
          variant="inset"
          user={sidebarUser}
          tenants={memberships}
          activeTenantId={tenant.tenantId}
        />
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
      </PermissionProvider>
      </PreferencesProvider>
    </TenantProvider>
  )
}
