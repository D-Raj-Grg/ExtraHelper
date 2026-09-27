import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { money } from "@/lib/format"
import { indexCredit } from "@/lib/customer-credit"
import { ReportSection } from "./report-section"
import { StatTiles } from "./stat-tiles"
import type { ReportCtx } from "./types"

type Row = {
  customer_id: string
  name: string | null
  orders: number
  spend_cents: number
  points_redeemed: number
}

export async function CustomersTab({ supabase, tenantId, F, T, cur }: ReportCtx) {
  const [{ data }, { data: credit }] = await Promise.all([
    supabase.rpc("report_customers", { _tenant: tenantId, _from: F, _to: T }),
    // Not date-bounded on purpose: a debt is owed today whenever it was run up.
    supabase.rpc("customer_credit_summary", { _tenant: tenantId }),
  ])
  const { byCustomer, totalCents: totalOwed } = indexCredit(credit)
  const owed = new Map([...byCustomer].map(([id, c]) => [id, c.outstanding_cents]))
  const rows = (data ?? []) as Row[]

  const withOrders = rows.filter((r) => Number(r.orders) > 0)
  const repeat = withOrders.length
    ? Math.round((withOrders.filter((r) => Number(r.orders) > 1).length / withOrders.length) * 100)
    : 0
  const disp = rows.map((r) => ({
    customer: r.name ?? "Guest",
    orders: Number(r.orders),
    spend: money(r.spend_cents, cur),
    redeemed: Number(r.points_redeemed),
    outstanding: money(owed.get(r.customer_id) ?? 0, cur),
  }))

  return (
    <div className="flex flex-col gap-6">
      <StatTiles
        tiles={[
          { label: "Customers active", value: String(withOrders.length) },
          { label: "Repeat rate", value: `${repeat}%` },
          {
            label: "Points redeemed",
            value: String(rows.reduce((s, r) => s + Number(r.points_redeemed), 0)),
          },
          { label: "Credit outstanding now", value: money(totalOwed, cur), warn: totalOwed > 0 },
        ]}
      />

      <ReportSection
        title="Top customers"
        rows={disp}
        columns={[
          { key: "customer", label: "Customer" },
          { key: "orders", label: "Orders" },
          { key: "spend", label: "Spend" },
          { key: "redeemed", label: "Points redeemed" },
          { key: "outstanding", label: "Outstanding now" },
        ]}
        filename="customer-report"
        empty="No customer activity in this period."
      >
        <Table className="w-full text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-3 py-2 font-medium">Customer</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Orders</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Spend</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Redeemed</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Outstanding now</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.name ?? "guest"}-${i}`}>
                <TableCell className="px-3 py-2 font-medium">{r.name ?? "Guest"}</TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {Number(r.orders)}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums">
                  {money(r.spend_cents, cur)}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {Number(r.points_redeemed)}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums">
                  {(owed.get(r.customer_id) ?? 0) > 0 ? (
                    <span className="font-medium text-destructive">{money(owed.get(r.customer_id) ?? 0, cur)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ReportSection>
    </div>
  )
}
