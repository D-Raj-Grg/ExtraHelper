import { AppSidebar } from "@/components/app-sidebar"
import { PermissionProvider } from "@/components/permission-provider"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { getMyPermissions } from "@/lib/supabase/permissions"
import { getProfile } from "@/lib/supabase/profile"
import { getTenantMemberships } from "@/lib/supabase/tenant"
import type { ActiveTenant } from "@/lib/supabase/tenant"

/**
 * Everything the sidebar needs, resolved off the layout's critical path.
 *
 * Memberships (switcher), permissions (which nav items exist) and the profile
 * (footer avatar) are only ever read by the sidebar, so the layout streams them
 * behind a Suspense boundary instead of making the page wait on them. The page
 * body renders as soon as auth + tenant are known.
 *
 * `PermissionProvider` lives here rather than around the whole tree because the
 * sidebar is its only consumer — keeping it here is what lets the boundary sit
 * this low.
 */
export async function AppSidebarSection({
  tenant,
  userEmail,
  fallbackName,
}: {
  tenant: ActiveTenant
  userEmail: string
  /** Used until the profile row loads — auth metadata, then the email local part. */
  fallbackName: string
}) {
  const [memberships, permissions, profile] = await Promise.all([
    getTenantMemberships(),
    getMyPermissions(tenant.tenantId),
    getProfile(),
  ])

  const sidebarUser = {
    name: profile?.fullName ?? fallbackName,
    email: userEmail,
    avatar: profile?.avatarUrl ?? "",
  }

  return (
    <PermissionProvider permissions={permissions}>
      <AppSidebar
        variant="inset"
        user={sidebarUser}
        tenants={memberships}
        activeTenantId={tenant.tenantId}
      />
    </PermissionProvider>
  )
}

/**
 * Sidebar placeholder with the same chrome and row rhythm as the real one, so
 * the swap doesn't shift the page. Nav rows are unknowable before permissions
 * resolve — showing generic rows would flash items a role can't open.
 */
export function AppSidebarSkeleton() {
  return (
    <Sidebar collapsible="offcanvas" variant="inset">
      <SidebarHeader>
        <div className="flex items-center gap-2 p-1.5">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-4 w-32" />
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-2 px-2 py-2">
        <Skeleton className="h-8 w-full" />
        <div className="mt-2 space-y-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full opacity-60" />
          ))}
        </div>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 p-1.5">
          <Skeleton className="size-8 rounded-full" />
          <div className="space-y-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
