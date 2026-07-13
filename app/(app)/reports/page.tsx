import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { money } from "@/lib/format"
import { PageShell, PageHeader } from "@/components/page-header"
import { ExportButtons } from "@/components/export-buttons"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"

export const dynamic = "force-dynamic"

const WINDOWS = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
  { key: "year", label: "365 days" },
  { key: "all", label: "All time" },
] as const
type WindowKey = (typeof WINDOWS)[number]["key"]
const TABS = ["sales", "inventory", "staff", "customers"] as const
type Tab = (typeof TABS)[number]

// --- tenant-tz range math ----------------------------------------------------
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
  const m = Object.fromEntries(
    dtf.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  ) as Record<string, string>
  return Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second) - date.getTime()
}
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
    const end = new Date(tzMidnight(toP, tz).getTime() + 864e5)
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
type Breakdown = { label: string; orders: number; revenue_cents: number }

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; from?: string; to?: string; tab?: string }>
}) {
  const sp = await searchParams
  const window: WindowKey = (WINDOWS.find((x) => x.key === sp.window)?.key ?? "today") as WindowKey
  const tab: Tab = (TABS.find((t) => t === sp.tab) ?? "sales") as Tab
  const tenant = await requirePermission("reports.view")
  const supabase = await createClient()
  const tz = tenant.timezone
  const cur = tenant.currency
  const now = new Date()
  const { from, to, prevFrom, prevTo, custom } = resolveRange(window, sp.from, sp.to, now, tz)
  const F = from.toISOString(), T = to.toISOString()
  const rangeQs = custom ? `from=${sp.from}&to=${sp.to}` : `window=${window}`
  const tabHref = (t: Tab) => `/reports?tab=${t}&${rangeQs}`

  return (
    <PageShell>
      <PageHeader title={<>{tenant.name} · Reports</>} description="Paid-bill analytics, tenant-tz. Export CSV or print." />

      {/* Tabs */}
      <div className="mb-3 flex flex-wrap gap-2 print:hidden">
        {TABS.map((t) => (
          <Link key={t} href={tabHref(t)}
            className={`rounded-full px-3 py-1 text-sm capitalize ${t === tab ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
            {t}
          </Link>
        ))}
      </div>

      {/* Window + custom range */}
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        {WINDOWS.map((x) => (
          <Link key={x.key} href={`/reports?tab=${tab}&window=${x.key}`}
            className={`rounded-full px-3 py-1 text-sm ${!custom && x.key === window ? "bg-secondary text-secondary-foreground ring-1 ring-ring" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
            {x.label}
          </Link>
        ))}
      </div>
      <form method="get" className="mb-6 flex flex-wrap items-end gap-2 print:hidden">
        <input type="hidden" name="tab" value={tab} />
        <label className="flex flex-col text-xs text-muted-foreground">From
          <input type="date" name="from" defaultValue={custom ? sp.from : ""} className="mt-0.5 h-9 rounded-md border bg-transparent px-2 text-sm" /></label>
        <label className="flex flex-col text-xs text-muted-foreground">To
          <input type="date" name="to" defaultValue={custom ? sp.to : ""} className="mt-0.5 h-9 rounded-md border bg-transparent px-2 text-sm" /></label>
        <button type="submit" className="h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground">Apply range</button>
        {custom ? <Link href={`/reports?tab=${tab}&window=today`} className="h-9 rounded-md border px-3 text-sm leading-9">Clear</Link> : null}
      </form>

      {tab === "sales" ? await SalesTab({ supabase, tenantId: tenant.tenantId, F, T, PF: prevFrom.toISOString(), PT: prevTo.toISOString(), tz, cur }) : null}
      {tab === "inventory" ? await InventoryTab({ supabase, tenantId: tenant.tenantId, F, T, cur }) : null}
      {tab === "staff" ? await StaffTab({ supabase, tenantId: tenant.tenantId, F, T, cur }) : null}
      {tab === "customers" ? await CustomersTab({ supabase, tenantId: tenant.tenantId, F, T, cur }) : null}
    </PageShell>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { supabase: any; tenantId: string; F: string; T: string; cur: string }

function Tiles({ tiles }: { tiles: { label: string; value: string; delta?: string | null; warn?: boolean }[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">{t.label}</p>
          <p className={`mt-1 text-xl font-bold ${t.warn ? "text-amber-600 dark:text-amber-400" : ""}`}>{t.value}</p>
          {t.delta ? <p className={`text-xs ${t.delta.startsWith("▼") ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>{t.delta} vs prev</p> : null}
        </div>
      ))}
    </div>
  )
}

function BreakdownTable({ title, rows, cur, file }: { title: string; rows: Breakdown[]; cur: string; file: string }) {
  const disp = rows.map((r) => ({ label: r.label, orders: r.orders, revenue: money(r.revenue_cents, cur) }))
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <ExportButtons rows={disp} columns={[{ key: "label", label: title }, { key: "orders", label: "Orders" }, { key: "revenue", label: "Revenue" }]} filename={file} />
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No data.</p> : (
        <div className="overflow-x-auto rounded-lg border"><Table className="w-full text-sm"><TableBody>
          {rows.map((r) => (
            <TableRow key={r.label} className="border-b last:border-0">
              <TableCell className="px-3 py-2">{r.label}</TableCell>
              <TableCell className="px-3 py-2 text-muted-foreground">{r.orders} orders</TableCell>
              <TableCell className="px-3 py-2 text-right">{money(r.revenue_cents, cur)}</TableCell>
            </TableRow>
          ))}
        </TableBody></Table></div>
      )}
    </section>
  )
}

async function SalesTab({ supabase, tenantId, F, T, PF, PT, tz, cur }: Ctx & { PF: string; PT: string; tz: string }) {
  const [c1, p1, byCat, byType, byHour, byTable, extras, top, pays, branches] = await Promise.all([
    supabase.rpc("report_sales", { _tenant: tenantId, _from: F, _to: T }),
    supabase.rpc("report_sales", { _tenant: tenantId, _from: PF, _to: PT }),
    supabase.rpc("report_sales_by_category", { _tenant: tenantId, _from: F, _to: T }),
    supabase.rpc("report_sales_by_bill", { _tenant: tenantId, _from: F, _to: T, _dim: "order_type", _tz: tz }),
    supabase.rpc("report_sales_by_bill", { _tenant: tenantId, _from: F, _to: T, _dim: "hour", _tz: tz }),
    supabase.rpc("report_sales_by_bill", { _tenant: tenantId, _from: F, _to: T, _dim: "table", _tz: tz }),
    supabase.rpc("report_extras", { _tenant: tenantId, _from: F, _to: T }),
    supabase.rpc("report_top_items", { _tenant: tenantId, _from: F, _to: T, _limit: 10, _offset: 0 }),
    supabase.rpc("report_payments", { _tenant: tenantId, _from: F, _to: T }),
    supabase.rpc("report_by_branch", { _tenant: tenantId, _from: F, _to: T }),
  ])
  const topItems = (top.data ?? []) as { description: string; qty: number; revenue_cents: number }[]
  const payments = (pays.data ?? []) as { method: string; amount_cents: number }[]
  const byBranch = ((branches.data ?? []) as { branch_name: string; orders: number; revenue_cents: number }[])
    .map((b) => ({ label: b.branch_name, orders: b.orders, revenue_cents: b.revenue_cents }))
  const zero: Sales = { revenue_cents: 0, orders: 0, tax_cents: 0, service_cents: 0, discount_cents: 0 }
  const c: Sales = c1.data?.[0] ?? zero
  const p: Sales = p1.data?.[0] ?? zero
  const e = (extras.data?.[0] ?? { voids: 0, refunds_cents: 0, tables_served: 0, paid_orders: 0 }) as { voids: number; refunds_cents: number; tables_served: number; paid_orders: number }
  const avg = c.orders > 0 ? Math.round(c.revenue_cents / c.orders) : 0
  const turnover = e.tables_served > 0 ? (e.paid_orders / e.tables_served).toFixed(1) : "—"
  const hours = (byHour.data ?? []).slice().sort((a: Breakdown, b: Breakdown) => a.label.localeCompare(b.label))

  return (
    <div className="flex flex-col gap-6">
      <Tiles tiles={[
        { label: "Revenue", value: money(c.revenue_cents, cur), delta: pct(c.revenue_cents, p.revenue_cents) },
        { label: "Orders", value: String(c.orders), delta: pct(c.orders, p.orders) },
        { label: "Avg ticket", value: money(avg, cur) },
        { label: "Tax", value: money(c.tax_cents, cur) },
        { label: "Discounts", value: money(c.discount_cents, cur) },
        { label: "Service", value: money(c.service_cents, cur) },
        { label: "Voids", value: String(e.voids), warn: e.voids > 0 },
        { label: "Refunds", value: money(e.refunds_cents, cur), warn: e.refunds_cents > 0 },
        { label: "Table turnover", value: turnover },
      ]} />
      <div className="grid gap-6 md:grid-cols-2">
        <BreakdownTable title="By category" rows={(byCat.data ?? []) as Breakdown[]} cur={cur} file="sales-by-category" />
        <BreakdownTable title="By order type" rows={(byType.data ?? []) as Breakdown[]} cur={cur} file="sales-by-order-type" />
        <BreakdownTable title="By hour" rows={hours as Breakdown[]} cur={cur} file="sales-by-hour" />
        <BreakdownTable title="By table" rows={(byTable.data ?? []) as Breakdown[]} cur={cur} file="sales-by-table" />
        <BreakdownTable title="By branch" rows={byBranch} cur={cur} file="sales-by-branch" />
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">By payment method</h2>
            <ExportButtons rows={payments.map((p) => ({ method: p.method, amount: money(p.amount_cents, cur) }))}
              columns={[{ key: "method", label: "Method" }, { key: "amount", label: "Amount" }]} filename="sales-by-payment" />
          </div>
          {payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments.</p> : (
            <div className="overflow-x-auto rounded-lg border"><Table className="w-full text-sm"><TableBody>
              {payments.map((p) => (
                <TableRow key={p.method} className="border-b last:border-0">
                  <TableCell className="px-3 py-2 capitalize">{p.method}</TableCell>
                  <TableCell className="px-3 py-2 text-right">{money(p.amount_cents, cur)}</TableCell>
                </TableRow>
              ))}
            </TableBody></Table></div>
          )}
        </section>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Top items</h2>
          <ExportButtons rows={topItems.map((t) => ({ item: t.description, qty: Number(t.qty), revenue: money(t.revenue_cents, cur) }))}
            columns={[{ key: "item", label: "Item" }, { key: "qty", label: "Qty" }, { key: "revenue", label: "Revenue" }]} filename="top-items" />
        </div>
        {topItems.length === 0 ? <p className="text-sm text-muted-foreground">No sales in this period.</p> : (
          <div className="overflow-x-auto rounded-lg border"><Table className="w-full text-sm"><TableBody>
            {topItems.map((t) => (
              <TableRow key={t.description} className="border-b last:border-0">
                <TableCell className="px-3 py-2">{t.description}</TableCell>
                <TableCell className="px-3 py-2 text-muted-foreground">×{Number(t.qty)}</TableCell>
                <TableCell className="px-3 py-2 text-right">{money(t.revenue_cents, cur)}</TableCell>
              </TableRow>
            ))}
          </TableBody></Table></div>
        )}
      </section>
    </div>
  )
}

async function InventoryTab({ supabase, tenantId, F, T, cur }: Ctx) {
  const { data } = await supabase.rpc("report_inventory", { _tenant: tenantId, _from: F, _to: T })
  const rows = (data ?? []) as { name: string; uom: string; current_qty: number; consumed: number; wasted: number; cogs_cents: number; valuation_cents: number; reorder_qty: number }[]
  const disp = rows.map((r) => ({
    item: r.name, uom: r.uom, on_hand: Number(r.current_qty), consumed: Number(r.consumed),
    wasted: Number(r.wasted), cogs: money(r.cogs_cents, cur), valuation: money(r.valuation_cents, cur),
    reorder: Number(r.reorder_qty),
  }))
  const totalCogs = rows.reduce((s, r) => s + r.cogs_cents, 0)
  const totalVal = rows.reduce((s, r) => s + r.valuation_cents, 0)
  return (
    <div className="flex flex-col gap-4">
      <Tiles tiles={[
        { label: "COGS (period)", value: money(totalCogs, cur) },
        { label: "Stock valuation", value: money(totalVal, cur) },
        { label: "Needs reorder", value: String(rows.filter((r) => Number(r.reorder_qty) > 0).length), warn: rows.some((r) => Number(r.reorder_qty) > 0) },
      ]} />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Inventory report</h2>
        <ExportButtons rows={disp} columns={[
          { key: "item", label: "Item" }, { key: "uom", label: "UoM" }, { key: "on_hand", label: "On hand" },
          { key: "consumed", label: "Consumed" }, { key: "wasted", label: "Wasted" }, { key: "cogs", label: "COGS" },
          { key: "valuation", label: "Valuation" }, { key: "reorder", label: "Reorder qty" },
        ]} filename="inventory-report" />
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No inventory.</p> : (
        <div className="overflow-x-auto rounded-lg border"><Table className="w-full text-sm">
          <TableHeader className="bg-muted/50 text-left"><TableRow>
            <TableHead className="px-3 py-2 font-medium">Item</TableHead><TableHead className="px-3 py-2 font-medium">On hand</TableHead>
            <TableHead className="px-3 py-2 font-medium">Consumed</TableHead><TableHead className="px-3 py-2 font-medium">Wasted</TableHead>
            <TableHead className="px-3 py-2 font-medium text-right">COGS</TableHead><TableHead className="px-3 py-2 font-medium text-right">Valuation</TableHead>
            <TableHead className="px-3 py-2 font-medium text-right">Reorder</TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map((r) => (
            <TableRow key={r.name} className="border-t">
              <TableCell className="px-3 py-2 font-medium">{r.name}</TableCell>
              <TableCell className="px-3 py-2 text-muted-foreground">{Number(r.current_qty)} {r.uom}</TableCell>
              <TableCell className="px-3 py-2 text-muted-foreground">{Number(r.consumed)}</TableCell>
              <TableCell className="px-3 py-2 text-muted-foreground">{Number(r.wasted)}</TableCell>
              <TableCell className="px-3 py-2 text-right">{money(r.cogs_cents, cur)}</TableCell>
              <TableCell className="px-3 py-2 text-right">{money(r.valuation_cents, cur)}</TableCell>
              <TableCell className={`px-3 py-2 text-right ${Number(r.reorder_qty) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{Number(r.reorder_qty)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table></div>
      )}
    </div>
  )
}

async function StaffTab({ supabase, tenantId, F, T, cur }: Ctx) {
  const { data } = await supabase.rpc("report_staff", { _tenant: tenantId, _from: F, _to: T })
  const rows = (data ?? []) as { email: string; orders: number; revenue_cents: number; tips_cents: number; shift_minutes: number }[]
  const disp = rows.map((r) => ({
    staff: r.email, orders: Number(r.orders), revenue: money(r.revenue_cents, cur),
    tips: money(r.tips_cents, cur), hours: (Number(r.shift_minutes) / 60).toFixed(1),
  }))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Staff report</h2>
        <ExportButtons rows={disp} columns={[
          { key: "staff", label: "Staff" }, { key: "orders", label: "Orders" }, { key: "revenue", label: "Revenue" },
          { key: "tips", label: "Tips" }, { key: "hours", label: "Shift hours" },
        ]} filename="staff-report" />
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No staff activity in this period. (Waiter is recorded on new orders.)</p> : (
        <div className="overflow-x-auto rounded-lg border"><Table className="w-full text-sm">
          <TableHeader className="bg-muted/50 text-left"><TableRow>
            <TableHead className="px-3 py-2 font-medium">Staff</TableHead><TableHead className="px-3 py-2 font-medium">Orders</TableHead>
            <TableHead className="px-3 py-2 font-medium text-right">Revenue</TableHead><TableHead className="px-3 py-2 font-medium text-right">Tips</TableHead>
            <TableHead className="px-3 py-2 font-medium text-right">Shift hrs</TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map((r) => (
            <TableRow key={r.email} className="border-t">
              <TableCell className="px-3 py-2 font-medium">{r.email}</TableCell>
              <TableCell className="px-3 py-2 text-muted-foreground">{Number(r.orders)}</TableCell>
              <TableCell className="px-3 py-2 text-right">{money(r.revenue_cents, cur)}</TableCell>
              <TableCell className="px-3 py-2 text-right">{money(r.tips_cents, cur)}</TableCell>
              <TableCell className="px-3 py-2 text-right text-muted-foreground">{(Number(r.shift_minutes) / 60).toFixed(1)}h</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table></div>
      )}
    </div>
  )
}

async function CustomersTab({ supabase, tenantId, F, T, cur }: Ctx) {
  const { data } = await supabase.rpc("report_customers", { _tenant: tenantId, _from: F, _to: T })
  const rows = (data ?? []) as { name: string | null; orders: number; spend_cents: number; points_redeemed: number }[]
  const withOrders = rows.filter((r) => Number(r.orders) > 0)
  const repeat = withOrders.length ? Math.round((withOrders.filter((r) => Number(r.orders) > 1).length / withOrders.length) * 100) : 0
  const disp = rows.map((r) => ({
    customer: r.name ?? "Guest", orders: Number(r.orders), spend: money(r.spend_cents, cur), redeemed: Number(r.points_redeemed),
  }))
  return (
    <div className="flex flex-col gap-4">
      <Tiles tiles={[
        { label: "Customers active", value: String(withOrders.length) },
        { label: "Repeat rate", value: `${repeat}%` },
        { label: "Points redeemed", value: String(rows.reduce((s, r) => s + Number(r.points_redeemed), 0)) },
      ]} />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Top customers</h2>
        <ExportButtons rows={disp} columns={[
          { key: "customer", label: "Customer" }, { key: "orders", label: "Orders" }, { key: "spend", label: "Spend" }, { key: "redeemed", label: "Points redeemed" },
        ]} filename="customer-report" />
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No customer activity.</p> : (
        <div className="overflow-x-auto rounded-lg border"><Table className="w-full text-sm">
          <TableHeader className="bg-muted/50 text-left"><TableRow>
            <TableHead className="px-3 py-2 font-medium">Customer</TableHead><TableHead className="px-3 py-2 font-medium">Orders</TableHead>
            <TableHead className="px-3 py-2 font-medium text-right">Spend</TableHead><TableHead className="px-3 py-2 font-medium text-right">Redeemed</TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map((r, i) => (
            <TableRow key={i} className="border-t">
              <TableCell className="px-3 py-2 font-medium">{r.name ?? "Guest"}</TableCell>
              <TableCell className="px-3 py-2 text-muted-foreground">{Number(r.orders)}</TableCell>
              <TableCell className="px-3 py-2 text-right">{money(r.spend_cents, cur)}</TableCell>
              <TableCell className="px-3 py-2 text-right text-muted-foreground">{Number(r.points_redeemed)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table></div>
      )}
    </div>
  )
}
