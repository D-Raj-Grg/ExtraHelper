import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { PageShell, PageHeader } from "@/components/page-header"
import { NotificationTabs } from "@/components/notification-tabs"

export const dynamic = "force-dynamic"

export default async function NotificationsPage() {
  const tenant = await requirePermission("notifications.view")
  const supabase = await createClient()
  const canSeeActivity = tenant.role === "owner" || tenant.role === "manager"

  const [{ data: orders }, activityRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_type, status, created_at, restaurant_tables!orders_table_id_fkey(label)")
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false })
      .limit(50),
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
        description="New orders and sensitive activity for your restaurant."
      />
      <NotificationTabs
        orders={(orders ?? []) as never}
        activity={(activityRes.data ?? null) as never}
        tenantId={tenant.tenantId}
        timezone={tenant.timezone}
        canSeeActivity={canSeeActivity}
      />
    </PageShell>
  )
}
