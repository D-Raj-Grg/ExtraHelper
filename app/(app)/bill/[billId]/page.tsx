import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { BillView } from "@/components/bill-view"
import { PageShell } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function BillPage({
  params,
}: {
  params: Promise<{ billId: string }>
}) {
  const { billId } = await params
  const tenant = await requirePermission("checkout.view")
  const supabase = await createClient()

  const [{ data: bill }, { data: items }, { data: payments }] = await Promise.all([
    supabase
      .from("bills")
      .select(
        "id, status, subtotal_cents, tax_cents, service_charge_cents, discount_cents, total_cents, restaurant_tables(label)",
      )
      .eq("id", billId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle(),
    supabase
      .from("bill_items")
      .select("id, order_item_id, description, qty, unit_price_cents, total_cents")
      .eq("bill_id", billId)
      .eq("tenant_id", tenant.tenantId),
    supabase
      .from("payments")
      .select("id, method, amount_cents, created_at")
      .eq("bill_id", billId)
      .eq("tenant_id", tenant.tenantId)
      .eq("status", "completed")
      .order("created_at"),
  ])

  if (!bill) notFound()

  const paid = (payments ?? []).reduce((s, p) => s + p.amount_cents, 0)

  return (
    <PageShell width="narrow">
      <BillView
        currency={tenant.currency}
        bill={bill as never}
        items={items ?? []}
        payments={payments ?? []}
        paidCents={paid}
        canDiscount={tenant.role === "owner" || tenant.role === "manager"}
      />
    </PageShell>
  )
}
