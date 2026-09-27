import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { getMyPermissions } from "@/lib/supabase/permissions"
import { PageShell, PageHeader } from "@/components/page-header"
import { DayClose } from "@/components/reports/day-close"
import { DayPicker } from "@/components/reports/day-picker"
import { ReportEmpty } from "@/components/reports/report-section"
import { DAY_ORDER_LIMIT, type DayOrder } from "@/components/reports/day-order-utils"
import type { DayReport } from "@/components/reports/day-report"
import { businessDay } from "@/lib/format"
import { isYmd } from "@/lib/report-range"
import { RECEIPT_URL_TTL_SECONDS } from "@/lib/expense-constants"

export const dynamic = "force-dynamic"

/**
 * The day-close (Z) sheet: one business day, on its own route.
 *
 * Not a fifth tab on /reports — that page resolves a *range* and hands every
 * tab the same ctx, so the range pills and the vs-prev comparison would render
 * meaningless controls over a single day. This is the URL a manager bookmarks
 * and a cashier opens at close.
 */
export default async function DayClosePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const sp = await searchParams
  const tenant = await requirePermission("reports.view")

  // The tenant's current business day, which is not necessarily today's date —
  // a 4am cutoff means 01:30 is still yesterday. Same rule the RPC applies.
  const today = businessDay(new Date(), tenant.timezone, tenant.dayCutoffMinutes)
  const date = isYmd(sp.date) && sp.date <= today ? sp.date : today

  // Cost snapshots ride along on the order lines only for a viewer who may see
  // profit; the RPC strips its own profit keys on the same rule.
  const canViewProfit = (await getMyPermissions(tenant.tenantId)).includes("profit.view")

  const supabase = await createClient()
  const { data } = await supabase.rpc("daily_report", {
    _tenant: tenant.tenantId,
    _day: date,
  })
  const report = data as unknown as DayReport | null

  // Receipt photos sit in a private bucket; sign the day's in one call.
  const receiptPaths = (report?.expenses.items ?? [])
    .map((x) => x.receipt_path)
    .filter((p): p is string => !!p)
  if (report && receiptPaths.length) {
    const { data: signed } = await supabase.storage
      .from("expense-receipts")
      .createSignedUrls(receiptPaths, RECEIPT_URL_TTL_SECONDS)
    const urlByPath = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]))
    for (const x of report.expenses.items)
      x.receipt_url = x.receipt_path ? (urlByPath.get(x.receipt_path) ?? null) : null
  }

  // The ledger behind the totals. Bounded by the window the RPC itself resolved
  // (`from`/`to` off its own payload) rather than a second computation of the
  // business day — the list and the figures above it cannot then disagree about
  // which day this is, whatever the cutoff or the DST date.
  //
  // Fetched here rather than folded into the jsonb: a busy day is hundreds of
  // rows, and the payload is also what the thermal renderer reads, where a full
  // order list is neither wanted nor printable.
  let orders: DayOrder[] = []
  let truncated = false
  if (report) {
    const { data: rows } = await supabase
      .from("orders")
      .select(
        "id, order_type, status, created_at, guests, bill_id, " +
          "restaurant_tables!orders_table_id_fkey(label), " +
          // The lines ride along so the detail sheet opens with no round trip.
          // The cost snapshot lives in `order_item_costs` (RLS: profit.view
          // only), embedded one-to-one; skipped outright for anyone else so
          // the query never asks for rows it would be denied.
          `order_items(id, name_snapshot, qty, unit_price_cents, is_void, notes${
            canViewProfit ? ", order_item_costs(unit_cost_cents)" : ""
          }), ` +
          "bills!orders_bill_id_fkey(status, total_cents)",
      )
      .eq("tenant_id", tenant.tenantId)
      .gte("created_at", report.from)
      .lt("created_at", report.to)
      .order("created_at", { ascending: false })
      .order("created_at", { referencedTable: "order_items" })
      .limit(DAY_ORDER_LIMIT + 1)

    // Flatten the embed onto the line: `DayOrder` stays a plain row shape and
    // the arithmetic in day-order-utils never learns where the cost came from.
    type RawOrder = Omit<DayOrder, "order_items"> & {
      order_items: (Omit<DayOrder["order_items"][number], "unit_cost_cents"> & {
        order_item_costs?: { unit_cost_cents: number } | null
      })[]
    }
    const all: DayOrder[] = ((rows ?? []) as unknown as RawOrder[]).map((o) => ({
      ...o,
      order_items: (o.order_items ?? []).map(({ order_item_costs, ...l }) => ({
        ...l,
        unit_cost_cents: order_item_costs?.unit_cost_cents ?? null,
      })),
    }))
    truncated = all.length > DAY_ORDER_LIMIT
    orders = truncated ? all.slice(0, DAY_ORDER_LIMIT) : all
  }

  return (
    <PageShell>
      <PageHeader
        title="Day close"
        description={`${tenant.name}'s trading day, ready to sign off. Print it, export it, or file the PDF.`}
      />

      <DayPicker date={date} today={today} />

      {report ? (
        <DayClose
          r={report}
          orders={orders}
          ordersTruncated={truncated}
          canViewProfit={canViewProfit}
        />
      ) : (
        <ReportEmpty>
          This report needs the Reports permission. Ask an owner or manager to grant it.
        </ReportEmpty>
      )}
    </PageShell>
  )
}
