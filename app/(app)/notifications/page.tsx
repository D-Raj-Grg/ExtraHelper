import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { getMyPermissions } from "@/lib/supabase/permissions"
import { getCurrentUser } from "@/lib/supabase/user"
import { FEED_LIMIT, NOTIFICATION_SELECT, type AppNotification } from "@/lib/notification-constants"
import { PageShell, PageHeader } from "@/components/page-header"
import { PermissionProvider } from "@/components/permission-provider"
import { NotificationTabs } from "@/components/notification-tabs"

export const dynamic = "force-dynamic"

export default async function NotificationsPage() {
  const tenant = await requirePermission("notifications.view")
  const supabase = await createClient()
  const canSeeActivity = tenant.role === "owner" || tenant.role === "manager"

  const [permissions, user, { data: updates }, activityRes] = await Promise.all([
    // Request-cached: the guard above already read this set.
    getMyPermissions(tenant.tenantId),
    // Request-cached: the layout already read it.
    getCurrentUser(),
    supabase
      .from("notifications")
      .select(NOTIFICATION_SELECT)
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT),
    canSeeActivity
      ? supabase
          .from("audit_logs")
          .select("id, action, entity_type, metadata, created_at")
          .eq("tenant_id", tenant.tenantId)
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: null }),
  ])

  return (
    <PageShell>
      <PageHeader
        title="Notifications"
        description="Every step of every order — placed, cooking, ready, served, billed, paid — plus sensitive activity."
      />
      <PermissionProvider permissions={permissions}>
        <NotificationTabs
          updates={(updates ?? []) as AppNotification[]}
          activity={(activityRes.data ?? null) as never}
          tenantId={tenant.tenantId}
          timezone={tenant.timezone}
          currency={tenant.currency}
          canSeeActivity={canSeeActivity}
          userId={user?.id ?? ""}
        />
      </PermissionProvider>
    </PageShell>
  )
}
