import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { CheckoutView } from "@/components/checkout/checkout-view"
import { PageShell } from "@/components/page-header"
import type { CheckoutItem } from "@/components/checkout/types"
import type { ReceiptTemplate } from "@/lib/print/branding"

export const dynamic = "force-dynamic"

export default async function BillPage({
  params,
}: {
  params: Promise<{ billId: string }>
}) {
  const { billId } = await params
  const tenant = await requirePermission("checkout.view")
  const supabase = await createClient()

  const [
    { data: bill },
    { data: items },
    { data: payments },
    { data: charges },
    { data: order },
    { data: settings },
    { data: auth },
  ] = await Promise.all([
    supabase
      .from("bills")
      .select(
        "id, status, created_at, subtotal_cents, tax_cents, service_charge_cents, discount_cents, tip_cents, rounding_cents, total_cents, note, bill_printed_at, bill_printed_total_cents, restaurant_tables(label)",
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
      .from("bill_charges")
      .select("id, label, amount_cents")
      .eq("bill_id", billId)
      .eq("tenant_id", tenant.tenantId)
      .order("created_at"),
    supabase
      .from("orders")
      .select(
        "id, created_at, waiter_id, customer_id, customers(id, name, phone, loyalty_accounts(points_balance))",
      )
      .eq("bill_id", billId)
      .eq("tenant_id", tenant.tenantId)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("tenant_settings")
      .select("points_value_cents, receipt_template")
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle(),
    supabase.auth.getUser(),
  ])

  if (!bill) notFound()

  const orderItemIds = (items ?? [])
    .map((it) => it.order_item_id)
    .filter((id): id is string => id !== null)

  // Modifiers and per-line discounts hang off the ORDER item, not the bill
  // line — the checkout table shows both against the line they belong to.
  const [{ data: modifiers }, { data: lineDiscounts }, { data: people }, { data: staffDiscount }] =
    await Promise.all([
      orderItemIds.length
        ? supabase
            .from("order_item_modifiers")
            .select("id, order_item_id, name_snapshot, price_cents, qty")
            .in("order_item_id", orderItemIds)
            .eq("tenant_id", tenant.tenantId)
        : Promise.resolve({ data: [] as never[] }),
      orderItemIds.length
        ? supabase
            .from("discounts")
            .select("order_item_id, type, value")
            .eq("bill_id", billId)
            .eq("tenant_id", tenant.tenantId)
            .not("order_item_id", "is", null)
        : Promise.resolve({ data: [] as never[] }),
      supabase
        .from("profiles")
        .select("id, full_name, username")
        .in(
          "id",
          [auth.user?.id, (order as { waiter_id: string | null } | null)?.waiter_id].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      // The one discount staff put on the whole bill — a typed one or a comp.
      // Same predicate as `remove_bill_discount`: a coupon is the guest's and is
      // never taken off by the Remove control next to the Discount row.
      supabase
        .from("discounts")
        .select("id")
        .eq("bill_id", billId)
        .eq("tenant_id", tenant.tenantId)
        .is("order_item_id", null)
        .is("coupon_code", null)
        .limit(1),
    ])

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

  const modsByItem = new Map<string, CheckoutItem["modifiers"]>()
  for (const m of modifiers ?? []) {
    const list = modsByItem.get(m.order_item_id) ?? []
    list.push({
      id: m.id,
      name: m.name_snapshot,
      price_cents: m.price_cents,
      qty: m.qty,
    })
    modsByItem.set(m.order_item_id, list)
  }

  const checkoutItems: CheckoutItem[] = (items ?? []).map((it) => {
    const lineGross = it.unit_price_cents * it.qty
    // Same rule the server uses (bill_discount_total): percent off the line,
    // flat capped at the line. Display only — the total still comes from SQL.
    const discount = (lineDiscounts ?? [])
      .filter((d) => d.order_item_id === it.order_item_id)
      .reduce(
        (n, d) =>
          n +
          (d.type === "percent"
            ? Math.round((lineGross * Number(d.value)) / 100)
            : Math.min(Math.round(Number(d.value) * 100), lineGross)),
        0,
      )
    return {
      id: it.id,
      order_item_id: it.order_item_id,
      description: it.description,
      qty: it.qty,
      unit_price_cents: it.unit_price_cents,
      total_cents: it.total_cents,
      discount_cents: Math.min(discount, lineGross),
      modifiers: it.order_item_id ? (modsByItem.get(it.order_item_id) ?? []) : [],
    }
  })

  // Flatten the customer + points for the loyalty panel.
  const cust = (order as { customers: unknown } | null)?.customers as
    | {
        id: string
        name: string | null
        phone: string | null
        loyalty_accounts: { points_balance: number }[] | null
      }
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

  const nameOf = (id: string | null | undefined) => {
    if (!id) return null
    const p = (people ?? []).find((row) => row.id === id)
    return p?.full_name ?? p?.username ?? null
  }
  const orderRow = order as {
    created_at: string
    waiter_id: string | null
  } | null
  const template = (settings?.receipt_template ?? {}) as ReceiptTemplate

  return (
    <PageShell width="full">
      <CheckoutView
        currency={tenant.currency}
        bill={bill as never}
        items={checkoutItems}
        payments={payments ?? []}
        charges={charges ?? []}
        paidCents={paid}
        canDiscount={tenant.role === "owner" || tenant.role === "manager"}
        hasStaffDiscount={(staffDiscount ?? []).length > 0}
        customer={customer}
        pointsValueCents={settings?.points_value_cents ?? 1}
        mergeableOrders={(mergeable ?? []) as never}
        meta={{
          tenantName: tenant.name,
          timezone: tenant.timezone,
          billedBy: nameOf(auth.user?.id) ?? auth.user?.email ?? "Staff",
          waiterName: nameOf(orderRow?.waiter_id),
          // Minutes are computed here (server) so the preview can't drift
          // between the SSR pass and hydration.
          serviceMinutes: orderRow
            ? Math.max(
                0,
                // eslint-disable-next-line react-hooks/purity -- async server component: renders once per request, never re-renders, so this clock read is stable.
                Math.round((Date.now() - new Date(orderRow.created_at).getTime()) / 60000),
              )
            : null,
          header: template.header,
          footer: template.footer,
          terms: template.terms,
          logoUrl: template.logo_url,
          qrUrl: template.qr_url,
          qrCaption: template.qr_caption,
        }}
      />
    </PageShell>
  )
}
