import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { PurchasingManager } from "@/components/purchasing-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function PurchasingPage() {
  const tenant = await requirePermission("purchasing.view")
  const supabase = await createClient()

  const [{ data: suppliers }, { data: items }, { data: pos }, { data: balances }, { data: payments }] =
    await Promise.all([
      supabase.from("suppliers").select("id, name, phone").eq("tenant_id", tenant.tenantId).order("name"),
      supabase.from("inventory_items").select("id, name, uom").eq("tenant_id", tenant.tenantId).order("name"),
      supabase
        .from("purchase_orders")
        .select(
          "id, status, created_at, supplier_id, suppliers(name), po_items(id, qty_ordered, qty_received, unit_cost_cents, inventory_items(name, uom))",
        )
        .eq("tenant_id", tenant.tenantId)
        .order("created_at", { ascending: false }),
      supabase.rpc("supplier_balances"),
      supabase
        .from("supplier_payments")
        .select("po_id, amount_cents")
        .eq("tenant_id", tenant.tenantId)
        .not("po_id", "is", null),
    ])

  // Paid-per-PO, summed here rather than in a second RPC: the rows are already
  // scoped to the tenant and there are few of them.
  const paidByPo: Record<string, number> = {}
  for (const p of payments ?? []) {
    if (p.po_id) paidByPo[p.po_id] = (paidByPo[p.po_id] ?? 0) + p.amount_cents
  }

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
        balances={balances ?? []}
        paidByPo={paidByPo}
      />
    </PageShell>
  )
}
