import Link from "next/link"
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  ChefHatIcon,
  ReceiptIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  UtensilsCrossedIcon,
} from "lucide-react"
import { requireTenant } from "@/lib/supabase/guards"
import { createClient } from "@/lib/supabase/server"
import { money, formatDateTime } from "@/lib/format"
import { DashboardRevenueChart } from "@/components/dashboard-revenue-chart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const dynamic = "force-dynamic"

const ACTIVE_ORDER_STATES = ["draft", "placed", "in_kitchen", "preparing", "ready", "served"]
const ACTIVE_KOT_STATES = ["new", "preparing", "ready"]
const DAY = 86_400_000

// Auth + tenant gating + the sidebar shell are handled by app/(app)/layout.tsx.
export default async function DashboardPage() {
  const tenant = await requireTenant()
  const supabase = await createClient()
  const tz = tenant.timezone
  const since = new Date(Date.now() - 15 * DAY).toISOString()

  const [paidBills, activeOrders, kots, inventory, reservations, recentBills] = await Promise.all([
    supabase
      .from("bills")
      .select("total_cents, created_at")
      .eq("tenant_id", tenant.tenantId)
      .eq("status", "paid")
      .gte("created_at", since),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.tenantId)
      .in("status", ACTIVE_ORDER_STATES),
    supabase
      .from("kots")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.tenantId)
      .in("status", ACTIVE_KOT_STATES),
    supabase
      .from("inventory_items")
      .select("name, uom, current_qty, reorder_level")
      .eq("tenant_id", tenant.tenantId),
    supabase
      .from("reservations")
      .select("party_size, reserved_at, status, customers(name), restaurant_tables(label)")
      .eq("tenant_id", tenant.tenantId)
      .in("status", ["pending", "confirmed", "seated"])
      .gte("reserved_at", new Date(Date.now() - 2 * 3_600_000).toISOString())
      .order("reserved_at")
      .limit(6),
    supabase
      .from("bills")
      .select("id, total_cents, created_at, restaurant_tables(label)")
      .eq("tenant_id", tenant.tenantId)
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(6),
  ])

  // --- tz-aware daily bucketing -------------------------------------------
  const dayKey = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso))
  const bills = paidBills.data ?? []
  const revByDay = new Map<string, number>()
  for (const b of bills) revByDay.set(dayKey(b.created_at), (revByDay.get(dayKey(b.created_at)) ?? 0) + b.total_cents)

  const todayKey = dayKey(new Date().toISOString())
  const yestKey = dayKey(new Date(Date.now() - DAY).toISOString())
  const todayCents = revByDay.get(todayKey) ?? 0
  const yestCents = revByDay.get(yestKey) ?? 0
  const todayBillCount = bills.filter((b) => dayKey(b.created_at) === todayKey).length
  const avgCents = todayBillCount ? Math.round(todayCents / todayBillCount) : 0
  const deltaPct = yestCents > 0 ? ((todayCents - yestCents) / yestCents) * 100 : null

  const chart = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * DAY)
    return {
      day: new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(d),
      revenue: Math.round(revByDay.get(dayKey(d.toISOString())) ?? 0) / 100,
    }
  })

  const lowStock = (inventory.data ?? [])
    .filter((i) => Number(i.current_qty) < Number(i.reorder_level))
    .sort((a, b) => Number(a.current_qty) / Number(a.reorder_level) - Number(b.current_qty) / Number(b.reorder_level))
  const resv = (reservations.data ?? []) as unknown as {
    party_size: number
    reserved_at: string
    status: string
    customers: { name: string | null } | null
    restaurant_tables: { label: string } | null
  }[]
  const recent = (recentBills.data ?? []) as unknown as {
    id: string
    total_cents: number
    created_at: string
    restaurant_tables: { label: string } | null
  }[]

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{tenant.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Today at a glance · {tenant.timezone}</p>
      </div>

      {/* KPI cards -------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={<ReceiptIcon className="size-4" />}
          label="Revenue today"
          value={money(todayCents, tenant.currency)}
          delta={deltaPct}
          foot={deltaPct === null ? "No sales yesterday to compare" : "vs yesterday"}
        />
        <Kpi
          icon={<UtensilsCrossedIcon className="size-4" />}
          label="Paid orders today"
          value={String(todayBillCount)}
          foot={`Avg ${money(avgCents, tenant.currency)} / order`}
        />
        <Kpi
          icon={<ChefHatIcon className="size-4" />}
          label="Active orders"
          value={String(activeOrders.count ?? 0)}
          foot={`${kots.count ?? 0} kitchen tickets open`}
        />
        <Kpi
          icon={<AlertTriangleIcon className="size-4" />}
          label="Low-stock items"
          value={String(lowStock.length)}
          foot={lowStock.length ? "Need reorder" : "All stocked"}
          warn={lowStock.length > 0}
        />
      </div>

      <DashboardRevenueChart data={chart} currency={tenant.currency} />

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
            {lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing low. 👍</p>
            ) : (
              lowStock.slice(0, 6).map((i) => (
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
            {resv.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming reservations.</p>
            ) : (
              resv.map((r, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <CalendarClockIcon className="size-3.5 text-muted-foreground" />
                    <span className="font-medium">{r.customers?.name ?? "Guest"}</span>
                    <span className="text-muted-foreground">· {r.party_size} pax</span>
                    {r.restaurant_tables?.label ? (
                      <Badge variant="outline" className="text-xs">{r.restaurant_tables.label}</Badge>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground">{formatDateTime(r.reserved_at, tz)}</span>
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
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <div className="flex flex-col divide-y">
              {recent.map((b) => (
                <Link
                  key={b.id}
                  href={`/bill/${b.id}`}
                  className="flex items-center justify-between py-2 text-sm hover:text-primary"
                >
                  <span className="font-medium">
                    {b.restaurant_tables?.label ? `Table ${b.restaurant_tables.label}` : "Takeaway"}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground">{formatDateTime(b.created_at, tz)}</span>
                    <span className="font-semibold tabular-nums">{money(b.total_cents, tenant.currency)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
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
