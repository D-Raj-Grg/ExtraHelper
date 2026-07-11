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

/** Current + previous equal-length range for the selected window (UTC, from now). */
function ranges(window: WindowKey, now: Date) {
  const to = now
  let from: Date
  if (window === "today") {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  } else if (window === "week") {
    from = new Date(to.getTime() - 7 * 864e5)
  } else if (window === "month") {
    from = new Date(to.getTime() - 30 * 864e5)
  } else if (window === "year") {
    from = new Date(to.getTime() - 365 * 864e5)
  } else {
    from = new Date("2020-01-01T00:00:00Z")
  }
  const span = to.getTime() - from.getTime()
  const prevTo = from
  const prevFrom = new Date(from.getTime() - span)
  return { from, to, prevFrom, prevTo }
}

function pct(cur: number, prev: number): string | null {
  if (prev === 0) return cur > 0 ? "▲ new" : null
  const d = ((cur - prev) / prev) * 100
  return `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(0)}%`
}

type Sales = {
  revenue_cents: number
  orders: number
  tax_cents: number
  service_cents: number
  discount_cents: number
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>
}) {
  const { window: w } = await searchParams
  const window: WindowKey = (WINDOWS.find((x) => x.key === w)?.key ?? "today") as WindowKey
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  const now = new Date()
  const { from, to, prevFrom, prevTo } = ranges(window, now)

  const [cur, prev, top, pays, branches] = await Promise.all([
    supabase.rpc("report_sales", { _tenant: tenant.tenantId, _from: from.toISOString(), _to: to.toISOString() }),
    supabase.rpc("report_sales", { _tenant: tenant.tenantId, _from: prevFrom.toISOString(), _to: prevTo.toISOString() }),
    supabase.rpc("report_top_items", { _tenant: tenant.tenantId, _from: from.toISOString(), _to: to.toISOString() }),
    supabase.rpc("report_payments", { _tenant: tenant.tenantId, _from: from.toISOString(), _to: to.toISOString() }),
    supabase.rpc("report_by_branch", { _tenant: tenant.tenantId, _from: from.toISOString(), _to: to.toISOString() }),
  ])

  const c: Sales = cur.data?.[0] ?? { revenue_cents: 0, orders: 0, tax_cents: 0, service_cents: 0, discount_cents: 0 }
  const p: Sales = prev.data?.[0] ?? { revenue_cents: 0, orders: 0, tax_cents: 0, service_cents: 0, discount_cents: 0 }
  const avg = c.orders > 0 ? Math.round(c.revenue_cents / c.orders) : 0
  const prevAvg = p.orders > 0 ? Math.round(p.revenue_cents / p.orders) : 0
  const topItems = (top.data ?? []) as { description: string; qty: number; revenue_cents: number }[]
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

      <div className="mb-6 flex flex-wrap gap-2">
        {WINDOWS.map((x) => (
          <Link
            key={x.key}
            href={`/reports?window=${x.key}`}
            className={`rounded-full px-3 py-1 text-sm ${
              x.key === window
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            {x.label}
          </Link>
        ))}
      </div>

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
