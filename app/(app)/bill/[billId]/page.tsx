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

  const [{ data: bill }, { data: items }, { data: payments }, { data: order }, { data: settings }] =
    await Promise.all([
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
      supabase
        .from("orders")
        .select("customer_id, customers(id, name, phone, loyalty_accounts(points_balance))")
        .eq("bill_id", billId)
        .eq("tenant_id", tenant.tenantId)
        .not("customer_id", "is", null)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("tenant_settings")
        .select("points_value_cents")
        .eq("tenant_id", tenant.tenantId)
        .maybeSingle(),
    ])

  if (!bill) notFound()

  // Orders that could be merged onto this open bill (fired, not yet billed).
  const { data: mergeable } =
    bill.status === "open" || bill.status === "partial"
      ? await supabase
          .from("orders")
          .select("id, order_type, status, restaurant_tables!orders_table_id_fkey(label)")
          .eq("tenant_id", tenant.tenantId)
          .is("bill_id", null)
          .in("status", ["in_kitchen", "preparing", "ready", "served"])
          .order("created_at", { ascending: false })
      : { data: [] }

  const paid = (payments ?? []).reduce((s, p) => s + p.amount_cents, 0)

  // Flatten the customer + points for the loyalty panel.
  const cust = (order as { customers: unknown } | null)?.customers as
    | { id: string; name: string | null; phone: string | null; loyalty_accounts: { points_balance: number }[] | null }
    | null
    | undefined
  const customer = cust
    ? {
        id: cust.id,
        name: cust.name,
        phone: cust.phone,
        points: cust.loyalty_accounts?.[0]?.points_balance ?? 0,
      }
    : null

  return (
    <PageShell width="narrow">
      <BillView
        currency={tenant.currency}
        bill={bill as never}
        items={items ?? []}
        payments={payments ?? []}
        paidCents={paid}
        canDiscount={tenant.role === "owner" || tenant.role === "manager"}
        customer={customer}
        pointsValueCents={settings?.points_value_cents ?? 1}
        mergeableOrders={(mergeable ?? []) as never}
      />
    </PageShell>
  )
}
