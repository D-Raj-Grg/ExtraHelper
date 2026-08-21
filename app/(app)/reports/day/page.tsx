import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { PageShell, PageHeader } from "@/components/page-header"
import { DayClose } from "@/components/reports/day-close"
import { DayPicker } from "@/components/reports/day-picker"
import { ReportEmpty } from "@/components/reports/report-section"
import { DAY_ORDER_LIMIT, type DayOrder } from "@/components/reports/day-orders"
import type { DayReport } from "@/components/reports/day-report"
import { businessDay } from "@/lib/format"
import { isYmd } from "@/lib/report-range"

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

  const supabase = await createClient()
  const { data } = await supabase.rpc("daily_report", {
    _tenant: tenant.tenantId,
    _day: date,
  })
  const report = data as unknown as DayReport | null

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
          "order_items(id, name_snapshot, qty, unit_price_cents, is_void, notes), " +
          "bills!orders_bill_id_fkey(status, total_cents)",
      )
      .eq("tenant_id", tenant.tenantId)
      .gte("created_at", report.from)
      .lt("created_at", report.to)
      .order("created_at", { ascending: false })
      .order("created_at", { referencedTable: "order_items" })
      .limit(DAY_ORDER_LIMIT + 1)

    const all = (rows ?? []) as unknown as DayOrder[]
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
        <DayClose r={report} orders={orders} ordersTruncated={truncated} />
      ) : (
        <ReportEmpty>
          This report needs the Reports permission. Ask an owner or manager to grant it.
        </ReportEmpty>
      )}
    </PageShell>
  )
}
