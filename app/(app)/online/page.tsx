import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requirePermission, tenantHasFeature } from "@/lib/supabase/guards"
import { OnlineManager } from "@/components/online-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function OnlinePage() {
  const tenant = await requirePermission("online.view")
  if (!(await tenantHasFeature(tenant.tenantId, "online_store"))) redirect("/billing")
  const supabase = await createClient()

  const { data: orders } = await supabase
    .from("online_orders")
    .select(
      "id, fulfillment, status, fee_cents, address, created_at, customers(name, phone), orders(order_items(name_snapshot, qty, unit_price_cents)), delivery_tracking(status, driver_name)",
    )
    .eq("tenant_id", tenant.tenantId)
    .order("created_at", { ascending: false })

  return (
    <PageShell>
      <PageHeader
        title={<>{tenant.name} · Online Orders</>}
        description={<>Delivery &amp; pickup orders from the storefront. Update status, dispatch delivery.</>}
      />
      <OnlineManager currency={tenant.currency} timezone={tenant.timezone} orders={(orders ?? []) as never} />
    </PageShell>
  )
}
