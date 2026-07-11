import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requireRole, tenantHasFeature } from "@/lib/supabase/guards"
import { OnlineManager } from "@/components/online-manager"

export const dynamic = "force-dynamic"

export default async function OnlinePage() {
  const tenant = await requireRole("owner", "manager", "cashier")
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
    <div className="mx-auto w-full max-w-4xl p-6 md:p-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{tenant.name} · Online Orders</h1>
        <p className="text-sm text-muted-foreground">
          Delivery &amp; pickup orders from the storefront. Update status, dispatch delivery.
        </p>
      </div>
      <OnlineManager currency={tenant.currency} timezone={tenant.timezone} orders={(orders ?? []) as never} />
    </div>
  )
}
