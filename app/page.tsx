import { AppSidebar } from "@/components/app-sidebar"
import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { DataTable } from "@/components/data-table"
import { SectionCards } from "@/components/section-cards"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getActiveTenant } from "@/lib/supabase/tenant"
import { TenantProvider } from "@/components/tenant-provider"

import data from "./data.json"

export default async function Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Unauthenticated is redirected to /login by the proxy; guard here too.
  if (!user) redirect("/login")

  // Signed in but no tenant yet → finish onboarding first.
  const tenant = await getActiveTenant()
  if (!tenant) redirect("/onboarding")

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
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        <AppSidebar variant="inset" user={sidebarUser} />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col">
            <div className="@container/main flex flex-1 flex-col gap-2">
              <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
                <SectionCards />
                <div className="px-4 lg:px-6">
                  <ChartAreaInteractive />
                </div>
                <DataTable data={data} />
              </div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TenantProvider>
  )
}
