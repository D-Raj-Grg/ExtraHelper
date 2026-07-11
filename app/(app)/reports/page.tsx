import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { money } from "@/lib/format"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

const WINDOWS = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
  { key: "year", label: "365 days" },
  { key: "all", label: "All time" },
] as const

type WindowKey = (typeof WINDOWS)[number]["key"]
const TOP_PAGE = 10

// --- tenant-tz range math (aligns with the dashboard's Intl bucketing) -------
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
  const m = Object.fromEntries(
    dtf.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  ) as Record<string, string>
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second)
  return asUtc - date.getTime()
}
/** UTC instant of tenant-tz midnight for a YYYY-MM-DD string. */
function tzMidnight(ymd: string, tz: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number)
  const off = tzOffsetMs(new Date(Date.UTC(y, mo - 1, d, 12)), tz)
  return new Date(Date.UTC(y, mo - 1, d) - off)
}
function isYmd(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function resolveRange(window: WindowKey, fromP: string | undefined, toP: string | undefined, now: Date, tz: string) {
  if (isYmd(fromP) && isYmd(toP)) {
    const from = tzMidnight(fromP, tz)
    const end = new Date(tzMidnight(toP, tz).getTime() + 864e5) // inclusive end day
    const span = end.getTime() - from.getTime()
    return { from, to: end, prevFrom: new Date(from.getTime() - span), prevTo: from, custom: true as const }
  }
  const to = now
  let from: Date
  if (window === "today") from = tzMidnight(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now), tz)
  else if (window === "week") from = new Date(to.getTime() - 7 * 864e5)
  else if (window === "month") from = new Date(to.getTime() - 30 * 864e5)
  else if (window === "year") from = new Date(to.getTime() - 365 * 864e5)
  else from = new Date("2020-01-01T00:00:00Z")
  const span = to.getTime() - from.getTime()
  return { from, to, prevFrom: new Date(from.getTime() - span), prevTo: from, custom: false as const }
}

function pct(cur: number, prev: number): string | null {
  if (prev === 0) return cur > 0 ? "▲ new" : null
  const d = ((cur - prev) / prev) * 100
  return `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(0)}%`
}

type Sales = { revenue_cents: number; orders: number; tax_cents: number; service_cents: number; discount_cents: number }

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; from?: string; to?: string; ti?: string }>
}) {
  const sp = await searchParams
  const window: WindowKey = (WINDOWS.find((x) => x.key === sp.window)?.key ?? "today") as WindowKey
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  const tz = tenant.timezone
  const now = new Date()
  const { from, to, prevFrom, prevTo, custom } = resolveRange(window, sp.from, sp.to, now, tz)
  const tiOffset = Math.max(0, Number(sp.ti) || 0)

  // preserve range filters across pill/pagination links
  const rangeQs = custom ? `from=${sp.from}&to=${sp.to}` : `window=${window}`

  const [cur, prev, top, pays, branches] = await Promise.all([
    supabase.rpc("report_sales", { _tenant: tenant.tenantId, _from: from.toISOString(), _to: to.toISOString() }),
    supabase.rpc("report_sales", { _tenant: tenant.tenantId, _from: prevFrom.toISOString(), _to: prevTo.toISOString() }),
    supabase.rpc("report_top_items", { _tenant: tenant.tenantId, _from: from.toISOString(), _to: to.toISOString(), _limit: TOP_PAGE + 1, _offset: tiOffset }),
    supabase.rpc("report_payments", { _tenant: tenant.tenantId, _from: from.toISOString(), _to: to.toISOString() }),
    supabase.rpc("report_by_branch", { _tenant: tenant.tenantId, _from: from.toISOString(), _to: to.toISOString() }),
  ])

  const zero: Sales = { revenue_cents: 0, orders: 0, tax_cents: 0, service_cents: 0, discount_cents: 0 }
  const c: Sales = cur.data?.[0] ?? zero
  const p: Sales = prev.data?.[0] ?? zero
  const avg = c.orders > 0 ? Math.round(c.revenue_cents / c.orders) : 0
  const prevAvg = p.orders > 0 ? Math.round(p.revenue_cents / p.orders) : 0
  const topRaw = (top.data ?? []) as { description: string; qty: number; revenue_cents: number }[]
  const topItems = topRaw.slice(0, TOP_PAGE)
  const topHasMore = topRaw.length > TOP_PAGE
  const payments = (pays.data ?? []) as { method: string; amount_cents: number }[]
  const byBranch = (branches.data ?? []) as { branch_id: string | null; branch_name: string; revenue_cents: number; orders: number }[]

  const tiles = [
    { label: "Revenue", value: money(c.revenue_cents, tenant.currency), delta: pct(c.revenue_cents, p.revenue_cents) },
    { label: "Orders", value: String(c.orders), delta: pct(c.orders, p.orders) },
    { label: "Avg ticket", value: money(avg, tenant.currency), delta: pct(avg, prevAvg) },
    { label: "Tax collected", value: money(c.tax_cents, tenant.currency), delta: null },
    { label: "Discounts", value: money(c.discount_cents, tenant.currency), delta: null },
    { label: "Service", value: money(c.service_cents, tenant.currency), delta: null },
  ]

  return (
    <PageShell>
      <PageHeader
        title={<>{tenant.name} · Reports</>}
        description="Paid-bill sales, vs previous period. Aggregated server-side."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {WINDOWS.map((x) => (
          <Link
            key={x.key}
            href={`/reports?window=${x.key}`}
            className={`rounded-full px-3 py-1 text-sm ${
              !custom && x.key === window
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            {x.label}
          </Link>
        ))}
      </div>

      {/* Custom date range */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-muted-foreground">
          From
          <input type="date" name="from" defaultValue={custom ? sp.from : ""}
            className="mt-0.5 h-9 rounded-md border bg-transparent px-2 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          To
          <input type="date" name="to" defaultValue={custom ? sp.to : ""}
            className="mt-0.5 h-9 rounded-md border bg-transparent px-2 text-sm" />
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground">
          Apply range
        </button>
        {custom ? (
          <Link href="/reports?window=today" className="h-9 rounded-md border px-3 text-sm leading-9">
            Clear
          </Link>
        ) : null}
      </form>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className="mt-1 text-xl font-bold">{t.value}</p>
            {t.delta ? (
              <p className={`text-xs ${t.delta.startsWith("▼") ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                {t.delta} vs prev
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-lg font-semibold">Top items</h2>
          {topItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sales in this period.</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <tbody>
                    {topItems.map((it) => (
                      <tr key={it.description} className="border-b last:border-0">
                        <td className="px-3 py-2">{it.description}</td>
                        <td className="px-3 py-2 text-muted-foreground">×{it.qty}</td>
                        <td className="px-3 py-2 text-right">{money(it.revenue_cents, tenant.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(tiOffset > 0 || topHasMore) ? (
                <div className="mt-2 flex justify-between text-sm">
                  {tiOffset > 0 ? (
                    <Link href={`/reports?${rangeQs}&ti=${Math.max(0, tiOffset - TOP_PAGE)}`} className="text-primary hover:underline">
                      ← Prev
                    </Link>
                  ) : <span />}
                  {topHasMore ? (
                    <Link href={`/reports?${rangeQs}&ti=${tiOffset + TOP_PAGE}`} className="text-primary hover:underline">
                      Next →
                    </Link>
                  ) : <span />}
                </div>
              ) : null}
            </>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">By branch (rollup)</h2>
          {byBranch.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sales in this period.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <tbody>
                  {byBranch.map((b) => (
                    <tr key={b.branch_id ?? "none"} className="border-b last:border-0">
                      <td className="px-3 py-2">{b.branch_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{b.orders} orders</td>
                      <td className="px-3 py-2 text-right">{money(b.revenue_cents, tenant.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">By payment method</h2>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments in this period.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <tbody>
                  {payments.map((p2) => (
                    <tr key={p2.method} className="border-b last:border-0">
                      <td className="px-3 py-2 capitalize">{p2.method}</td>
                      <td className="px-3 py-2 text-right">{money(p2.amount_cents, tenant.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PageShell>
  )
}
