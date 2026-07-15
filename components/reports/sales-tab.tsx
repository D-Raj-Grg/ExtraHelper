import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { money } from "@/lib/format"
import { delta } from "@/lib/report-range"
import { BreakdownTable, ReportSection } from "./report-section"
import { StatTiles } from "./stat-tiles"
import type { Breakdown, ReportCtx, Sales } from "./types"

const ZERO: Sales = {
  revenue_cents: 0,
  orders: 0,
  tax_cents: 0,
  service_cents: 0,
  discount_cents: 0,
}

export async function SalesTab({
  supabase,
  tenantId,
  F,
  T,
  PF,
  PT,
  tz,
  cur,
}: ReportCtx & { PF: string; PT: string; tz: string }) {
  const [c1, p1, byCat, byType, byHour, byTable, extras, top, pays, branches] = await Promise.all([
    supabase.rpc("report_sales", { _tenant: tenantId, _from: F, _to: T }),
    supabase.rpc("report_sales", { _tenant: tenantId, _from: PF, _to: PT }),
    supabase.rpc("report_sales_by_category", { _tenant: tenantId, _from: F, _to: T }),
    supabase.rpc("report_sales_by_bill", {
      _tenant: tenantId,
      _from: F,
      _to: T,
      _dim: "order_type",
      _tz: tz,
    }),
    supabase.rpc("report_sales_by_bill", { _tenant: tenantId, _from: F, _to: T, _dim: "hour", _tz: tz }),
    supabase.rpc("report_sales_by_bill", { _tenant: tenantId, _from: F, _to: T, _dim: "table", _tz: tz }),
    supabase.rpc("report_extras", { _tenant: tenantId, _from: F, _to: T }),
    supabase.rpc("report_top_items", { _tenant: tenantId, _from: F, _to: T, _limit: 10, _offset: 0 }),
    supabase.rpc("report_payments", { _tenant: tenantId, _from: F, _to: T }),
    supabase.rpc("report_by_branch", { _tenant: tenantId, _from: F, _to: T }),
  ])

  const topItems = (top.data ?? []) as { description: string; qty: number; revenue_cents: number }[]
  const payments = (pays.data ?? []) as { method: string; amount_cents: number }[]
  const byBranch = (
    (branches.data ?? []) as { branch_name: string; orders: number; revenue_cents: number }[]
  ).map((b) => ({ label: b.branch_name, orders: b.orders, revenue_cents: b.revenue_cents }))

  const c: Sales = c1.data?.[0] ?? ZERO
  const p: Sales = p1.data?.[0] ?? ZERO
  const e = (extras.data?.[0] ?? {
    voids: 0,
    refunds_cents: 0,
    tables_served: 0,
    paid_orders: 0,
  }) as { voids: number; refunds_cents: number; tables_served: number; paid_orders: number }

  const avg = c.orders > 0 ? Math.round(c.revenue_cents / c.orders) : 0
  const turnover = e.tables_served > 0 ? (e.paid_orders / e.tables_served).toFixed(1) : "—"
  const hours = ((byHour.data ?? []) as Breakdown[])
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="flex flex-col gap-6">
      <StatTiles
        tiles={[
          {
            label: "Revenue",
            value: money(c.revenue_cents, cur),
            delta: delta(c.revenue_cents, p.revenue_cents),
          },
          { label: "Orders", value: String(c.orders), delta: delta(c.orders, p.orders) },
          { label: "Avg ticket", value: money(avg, cur) },
          { label: "Tax", value: money(c.tax_cents, cur) },
          { label: "Discounts", value: money(c.discount_cents, cur) },
          { label: "Service", value: money(c.service_cents, cur) },
          { label: "Voids", value: String(e.voids), warn: e.voids > 0 },
          { label: "Refunds", value: money(e.refunds_cents, cur), warn: e.refunds_cents > 0 },
          { label: "Table turnover", value: turnover },
        ]}
      />

      <div className="grid gap-6 md:grid-cols-2">
        <BreakdownTable
          title="By category"
          rows={(byCat.data ?? []) as Breakdown[]}
          cur={cur}
          file="sales-by-category"
        />
        <BreakdownTable
          title="By order type"
          rows={(byType.data ?? []) as Breakdown[]}
          cur={cur}
          file="sales-by-order-type"
        />
        <BreakdownTable title="By hour" rows={hours} cur={cur} file="sales-by-hour" />
        <BreakdownTable
          title="By table"
          rows={(byTable.data ?? []) as Breakdown[]}
          cur={cur}
          file="sales-by-table"
        />
        <BreakdownTable title="By branch" rows={byBranch} cur={cur} file="sales-by-branch" />

        <ReportSection
          title="By payment method"
          rows={payments.map((p) => ({ method: p.method, amount: money(p.amount_cents, cur) }))}
          columns={[
            { key: "method", label: "Method" },
            { key: "amount", label: "Amount" },
          ]}
          filename="sales-by-payment"
          empty="No payments in this period."
        >
          <Table className="w-full text-sm">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="px-3 py-2 font-medium">Method</TableHead>
                <TableHead className="px-3 py-2 text-right font-medium">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.method}>
                  <TableCell className="px-3 py-2 capitalize">{p.method}</TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">
                    {money(p.amount_cents, cur)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ReportSection>
      </div>

      <ReportSection
        title="Top items"
        rows={topItems.map((t) => ({
          item: t.description,
          qty: Number(t.qty),
          revenue: money(t.revenue_cents, cur),
        }))}
        columns={[
          { key: "item", label: "Item" },
          { key: "qty", label: "Qty" },
          { key: "revenue", label: "Revenue" },
        ]}
        filename="top-items"
        empty="No sales in this period."
      >
        <Table className="w-full text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-3 py-2 font-medium">Item</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Qty</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topItems.map((t) => (
              <TableRow key={t.description}>
                <TableCell className="px-3 py-2">{t.description}</TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {Number(t.qty)}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums">
                  {money(t.revenue_cents, cur)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ReportSection>
    </div>
  )
}
