import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { PurchasingManager } from "@/components/purchasing-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function PurchasingPage() {
  const tenant = await requireRole("owner", "manager", "inventory")
  const supabase = await createClient()

  const [{ data: suppliers }, { data: items }, { data: pos }] = await Promise.all([
    supabase.from("suppliers").select("id, name, phone").eq("tenant_id", tenant.tenantId).order("name"),
    supabase.from("inventory_items").select("id, name, uom").eq("tenant_id", tenant.tenantId).order("name"),
    supabase
      .from("purchase_orders")
      .select(
        "id, status, created_at, suppliers(name), po_items(id, qty_ordered, qty_received, unit_cost_cents, inventory_items(name, uom))",
      )
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false }),
  ])

  return (
    <PageShell>
      <PageHeader
        title={<>{tenant.name} · Purchasing</>}
        description="Suppliers, purchase orders, and goods receipt (GRN restocks inventory)."
      />
      <PurchasingManager
        currency={tenant.currency}
        suppliers={suppliers ?? []}
        items={items ?? []}
        purchaseOrders={(pos ?? []) as never}
      />
    </PageShell>
  )
}
