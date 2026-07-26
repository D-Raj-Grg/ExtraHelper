import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { money } from "@/lib/format"
import { ReportSection } from "./report-section"
import { StatTiles } from "./stat-tiles"
import type { ReportCtx } from "./types"

type Row = {
  name: string | null
  orders: number
  spend_cents: number
  points_redeemed: number
}

export async function CustomersTab({ supabase, tenantId, F, T, cur }: ReportCtx) {
  const { data } = await supabase.rpc("report_customers", { _tenant: tenantId, _from: F, _to: T })
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ReportSection>
    </div>
  )
}
