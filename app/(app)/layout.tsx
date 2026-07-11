import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TenantProvider } from "@/components/tenant-provider"
import { PreferencesProvider } from "@/components/preferences-provider"
import { createClient } from "@/lib/supabase/server"
import { getActiveTenant, getTenantMemberships } from "@/lib/supabase/tenant"
import { getUserPreferences } from "@/lib/supabase/preferences"

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

  const [prefs, memberships] = await Promise.all([
    getUserPreferences(),
    getTenantMemberships(),
  ])

  const sidebarUser = {
    name:
      tenant.name ??
      (user.user_metadata?.restaurant_name as string) ??
      user.email?.split("@")[0] ??
      "User",
    email: user.email ?? "",
    avatar: "",
  }

  return (
    <TenantProvider tenant={tenant}>
      <PreferencesProvider initialTheme={prefs.theme} initialScale={prefs.scale}>
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
          <SiteHeader />
          {children}
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
      </PreferencesProvider>
    </TenantProvider>
  )
}
