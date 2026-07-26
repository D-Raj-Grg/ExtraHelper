import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { money } from "@/lib/format"
import { ReportSection } from "./report-section"
import type { ReportCtx } from "./types"

type Row = {
  email: string
  orders: number
  revenue_cents: number
  tips_cents: number
  shift_minutes: number
}

export async function StaffTab({ supabase, tenantId, F, T, cur }: ReportCtx) {
  const { data } = await supabase.rpc("report_staff", { _tenant: tenantId, _from: F, _to: T })
  const rows = (data ?? []) as Row[]

  const disp = rows.map((r) => ({
    staff: r.email,
    orders: Number(r.orders),
    revenue: money(r.revenue_cents, cur),
    tips: money(r.tips_cents, cur),
    hours: (Number(r.shift_minutes) / 60).toFixed(1),
  }))

  return (
    <ReportSection
      title="Staff report"
      rows={disp}
      columns={[
        { key: "staff", label: "Staff" },
        { key: "orders", label: "Orders" },
        { key: "revenue", label: "Revenue" },
        { key: "tips", label: "Tips" },
        { key: "hours", label: "Shift hours" },
      ]}
      filename="staff-report"
      empty="No staff activity in this period. The waiter is recorded when an order is created."
    >
      <Table className="w-full text-sm">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="px-3 py-2 font-medium">Staff</TableHead>
            <TableHead className="px-3 py-2 text-right font-medium">Orders</TableHead>
            <TableHead className="px-3 py-2 text-right font-medium">Revenue</TableHead>
            <TableHead className="px-3 py-2 text-right font-medium">Tips</TableHead>
            <TableHead className="px-3 py-2 text-right font-medium">Shift hrs</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.email}>
              <TableCell className="px-3 py-2 font-medium">{r.email}</TableCell>
              <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {Number(r.orders)}
              </TableCell>
              <TableCell className="px-3 py-2 text-right tabular-nums">
                {money(r.revenue_cents, cur)}
              </TableCell>
              <TableCell className="px-3 py-2 text-right tabular-nums">
                {money(r.tips_cents, cur)}
              </TableCell>
              <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {(Number(r.shift_minutes) / 60).toFixed(1)}h
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportSection>
  )
}
