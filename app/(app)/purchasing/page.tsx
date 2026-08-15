import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { PurchasingManager } from "@/components/purchasing/purchasing-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

/** Orders per page. Suppliers aren't paged — a restaurant has tens, not thousands. */
const PO_PAGE = 25
const PAY_PAGE = 50

const OPEN_STATUSES = ["draft", "sent", "partial"]

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string; page?: string }>
}) {
  const tenant = await requirePermission("purchasing.view")
  const supabase = await createClient()
  const sp = await searchParams

  // "What's outstanding" is the question this screen answers; "everything I
  // ever ordered" is an archive query, so open is the default view. Line detail
  // is fetched when an order's sheet opens, which is what lets the list stay a
  // single shallow query instead of every order with every nested ingredient.
  const showAll = sp.status === "all"
  const page = Math.max(1, Number(sp.page ?? 1) || 1)
  const from = (page - 1) * PO_PAGE

  let poQuery = supabase
    .from("purchase_orders")
    .select(
      "id, status, created_at, supplier_id, suppliers(name), po_items(id, qty_ordered, qty_received, unit_cost_cents)",
      { count: "exact" },
    )
    .eq("tenant_id", tenant.tenantId)
  if (!showAll) poQuery = poQuery.in("status", OPEN_STATUSES)

  const [
    { data: suppliers },
    { data: items },
    { data: pos, count: poCount },
    { data: balances },
    { data: payments },
    { data: summary },
    { data: canDeleteData },
  ] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name, contact, email, phone, archived_at")
      .eq("tenant_id", tenant.tenantId)
      .order("name"),
    supabase
      .from("inventory_items")
      .select("id, name, uom")
      .eq("tenant_id", tenant.tenantId)
      .order("name"),
    poQuery.order("created_at", { ascending: false }).range(from, from + PO_PAGE - 1),
    supabase.rpc("supplier_balances"),
    supabase
      .from("supplier_payments")
      .select(
        "id, supplier_id, po_id, amount_cents, method, paid_at, note, voided_at, void_reason, suppliers(name)",
      )
      .eq("tenant_id", tenant.tenantId)
      .order("paid_at", { ascending: false })
      .limit(PAY_PAGE),
    supabase.rpc("purchasing_summary", { _tenant: tenant.tenantId }),
    supabase.rpc("has_permission", { _tenant: tenant.tenantId, _key: "purchasing.delete" }),
  ])

  // Paid-per-order, scoped to the orders actually on this page rather than
  // pulling every payment row in the tenant to build the map.
  const poIds = (pos ?? []).map((p) => p.id)
  const { data: poPayments } = poIds.length
    ? await supabase
        .from("supplier_payments")
        .select("po_id, amount_cents")
        .in("po_id", poIds)
        .is("voided_at", null)
    : { data: [] }

  const paidByPo: Record<string, number> = {}
  for (const p of poPayments ?? []) {
    if (p.po_id) paidByPo[p.po_id] = (paidByPo[p.po_id] ?? 0) + p.amount_cents
  }

  return (
    <PageShell>
      <PageHeader
        title="Purchasing"
        description={`Suppliers, orders and what you owe · ${tenant.name}`}
      />
      <PurchasingManager
        currency={tenant.currency}
        timezone={tenant.timezone}
        suppliers={suppliers ?? []}
        items={items ?? []}
        purchaseOrders={(pos ?? []) as never}
        poCount={poCount ?? 0}
        poPage={page}
        poPageSize={PO_PAGE}
        showAll={showAll}
        balances={(balances ?? []) as never}
        payments={(payments ?? []) as never}
        paidByPo={paidByPo}
        summary={((summary as unknown as unknown[])?.[0] as never) ?? null}
        canDelete={canDeleteData === true}
        initialTab={sp.tab ?? "orders"}
      />
    </PageShell>
  )
}
