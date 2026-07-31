import Link from "next/link"
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  ChefHatIcon,
  LockIcon,
  ReceiptIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  UtensilsCrossedIcon,
} from "lucide-react"
import { requireTenant } from "@/lib/supabase/guards"
import { createClient } from "@/lib/supabase/server"
import { money } from "@/lib/format"
import { DashboardRevenueChart } from "@/components/dashboard-revenue-chart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageShell } from "@/components/page-header"

export const dynamic = "force-dynamic"

const WINDOWS = [7, 14, 30, 90] as const

/**
 * Shape of `dashboard_summary`. The RPC aggregates every figure in SQL, in the
 * tenant's timezone, and the Flutter app renders the same payload — so the
 * phone and this screen cannot disagree about today's revenue. It replaced six
 * parallel reads plus `Intl`-based day bucketing here (see the migration).
 */
type Summary = {
  currency: string
  timezone: string
  days: number
  today: { revenue_cents: number; bills: number; avg_cents: number }
  yesterday_revenue_cents: number
  active_orders: number
  open_kots: number
  low_stock_count: number
  series: { day: string; label: string; revenue_cents: number }[]
  low_stock: { name: string; uom: string; current_qty: number; reorder_level: number }[]
  reservations: {
    name: string
    party_size: number
    table_label: string | null
    status: string
    at: string
    at_text: string
  }[]
  recent_payments: {
    bill_id: string
    table_label: string | null
    total_cents: number
    at: string
    at_text: string
  }[]
}

// Auth + tenant gating + the sidebar shell are handled by app/(app)/layout.tsx.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ win?: string }>
}) {
  const { win } = await searchParams
  const days = (WINDOWS as readonly number[]).includes(Number(win)) ? Number(win) : 14
  const tenant = await requireTenant()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("dashboard_summary", {
    _tenant: tenant.tenantId,
    _days: days,
  })

  // The RPC answers null when the caller holds no `reports.view` — a kitchen or
  // inventory role landing on the home page is a state, not a fault. Before
  // this, every member of a restaurant saw its revenue on `/`.
  const summary = (data ?? null) as Summary | null

  return (
    <PageShell>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tenant.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Today at a glance · {tenant.timezone}</p>
        </div>

        {error ? (
          <Card>
            <CardHeader>
              <CardTitle>Couldn&apos;t load the dashboard</CardTitle>
              <CardDescription>{error.message}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/" />}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : !summary ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LockIcon className="size-4" /> No access to reports
              </CardTitle>
              <CardDescription>
                Your role in this restaurant doesn&apos;t include seeing revenue. An owner or manager
                can change that under Team.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <DashboardBody summary={summary} days={days} />
        )}
      </div>
    </PageShell>
  )
}

function DashboardBody({ summary, days }: { summary: Summary; days: number }) {
  const currency = summary.currency
  const yest = summary.yesterday_revenue_cents
  // Yesterday at zero is not a baseline — the same rule the Flutter app applies.
  const deltaPct = yest > 0 ? ((summary.today.revenue_cents - yest) / yest) * 100 : null

  const chart = summary.series.map((d) => ({
    day: d.label,
    revenue: d.revenue_cents / 100,
  }))

  return (
    <>
      {/* KPI cards -------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={<ReceiptIcon className="size-4" />}
          label="Revenue today"
          value={money(summary.today.revenue_cents, currency)}
          delta={deltaPct}
          foot={deltaPct === null ? "No sales yesterday to compare" : "vs yesterday"}
        />
        <Kpi
          icon={<UtensilsCrossedIcon className="size-4" />}
          label="Paid orders today"
          value={String(summary.today.bills)}
          foot={`Avg ${money(summary.today.avg_cents, currency)} / order`}
        />
        <Kpi
          icon={<ChefHatIcon className="size-4" />}
          label="Active orders"
          value={String(summary.active_orders)}
          foot={`${summary.open_kots} kitchen tickets open`}
        />
        <Kpi
          icon={<AlertTriangleIcon className="size-4" />}
          label="Low-stock items"
          value={String(summary.low_stock_count)}
          foot={summary.low_stock_count ? "Need reorder" : "All stocked"}
          warn={summary.low_stock_count > 0}
        />
      </div>

      <div className="flex items-center justify-end gap-1">
        {WINDOWS.map((w) => (
          <a
            key={w}
            href={`/?win=${w}`}
            className={`rounded-full px-2.5 py-1 text-xs ${
              w === days ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            {w}d
          </a>
        ))}
      </div>
      <DashboardRevenueChart data={chart} currency={currency} days={days} />

      {/* Two-column: low stock + reservations ---------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Low-stock alerts</CardTitle>
              <CardDescription>Below reorder level</CardDescription>
            </div>
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/purchasing" />}>
              Reorder
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {summary.low_stock.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is below its reorder level.</p>
            ) : (
              summary.low_stock.map((i) => (
                <div key={i.name} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{i.name}</span>
                  <span className="text-amber-600 dark:text-amber-400 tabular-nums">
                    {Number(i.current_qty)} / {Number(i.reorder_level)} {i.uom}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Upcoming reservations</CardTitle>
              <CardDescription>Next on the book</CardDescription>
            </div>
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/reservations" />}>
              Host board
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {summary.reservations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming reservations.</p>
            ) : (
              summary.reservations.map((r, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <CalendarClockIcon className="size-3.5 text-muted-foreground" />
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground">· {r.party_size} pax</span>
                    {r.table_label ? (
                      <Badge variant="outline" className="text-xs">{r.table_label}</Badge>
                    ) : null}
                  </span>
                  {/* Formatted by Postgres in the tenant's timezone. */}
                  <span className="text-muted-foreground tabular-nums">{r.at_text}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent payments ------------------------------------------------- */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Recent payments</CardTitle>
            <CardDescription>Latest paid bills</CardDescription>
          </div>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/reports" />}>
            Reports
          </Button>
        </CardHeader>
        <CardContent>
          {summary.recent_payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <div className="flex flex-col divide-y">
              {summary.recent_payments.map((b) => (
                <Link
                  key={b.bill_id}
                  href={`/bill/${b.bill_id}`}
                  className="flex items-center justify-between py-2 text-sm hover:text-primary"
                >
                  <span className="font-medium">
                    {b.table_label ? `Table ${b.table_label}` : "Takeaway"}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground tabular-nums">{b.at_text}</span>
                    <span className="font-semibold tabular-nums">{money(b.total_cents, currency)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function Kpi({
  icon,
  label,
  value,
  foot,
  delta,
  warn,
}: {
  icon: React.ReactNode
  label: string
  value: string
  foot: string
  delta?: number | null
  warn?: boolean
}) {
  const up = (delta ?? 0) >= 0
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{icon}</span>
          {label}
        </CardDescription>
        <CardTitle
          className={`text-2xl font-semibold tabular-nums @[250px]/card:text-3xl ${
            warn ? "text-amber-600 dark:text-amber-400" : ""
          }`}
        >
          {value}
        </CardTitle>
        {delta !== null && delta !== undefined ? (
          <div className="mt-1">
            <Badge variant="outline" className={up ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              {up ? <TrendingUpIcon className="size-3" /> : <TrendingDownIcon className="size-3" />}
              {up ? "+" : ""}
              {delta.toFixed(1)}%
            </Badge>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">{foot}</p>
      </CardContent>
    </Card>
  )
}
