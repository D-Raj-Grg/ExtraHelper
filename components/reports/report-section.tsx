import { ExportButtons } from "@/components/export-buttons"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { money } from "@/lib/format"
import type { CsvColumn } from "@/lib/csv"
import type { Breakdown } from "./types"

/**
 * One titled block of a report: heading, its own CSV/print export, and either
 * the table or an empty state. Every section on the page uses this so the
 * heading rhythm and export placement never drift.
 */
export function ReportSection({
  title,
  rows,
  columns,
  filename,
  empty,
  children,
}: {
  title: string
  /** Display-formatted rows handed to the CSV export. */
  rows: Record<string, unknown>[]
  columns: CsvColumn[]
  filename: string
  empty: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <ExportButtons rows={rows} columns={columns} filename={filename} />
      </div>
      {rows.length === 0 ? <ReportEmpty>{empty}</ReportEmpty> : <TableFrame>{children}</TableFrame>}
    </section>
  )
}

export function ReportEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-8 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

export function TableFrame({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-lg border">{children}</div>
}

/** Label / orders / revenue — the shape every sales cut shares. */
export function BreakdownTable({
  title,
  rows,
  cur,
  file,
}: {
  title: string
  rows: Breakdown[]
  cur: string
  file: string
}) {
  const disp = rows.map((r) => ({
    label: r.label,
    orders: r.orders,
    revenue: money(r.revenue_cents, cur),
  }))
  return (
    <ReportSection
      title={title}
      rows={disp}
      columns={[
        { key: "label", label: title },
        { key: "orders", label: "Orders" },
        { key: "revenue", label: "Revenue" },
      ]}
      filename={file}
      empty="No sales in this period."
    >
      <Table className="w-full text-sm">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="px-3 py-2 font-medium capitalize">
              {title.replace(/^By /, "")}
            </TableHead>
            <TableHead className="px-3 py-2 text-right font-medium">Orders</TableHead>
            <TableHead className="px-3 py-2 text-right font-medium">Revenue</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.label}>
              <TableCell className="px-3 py-2">{r.label}</TableCell>
              <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {r.orders}
              </TableCell>
              <TableCell className="px-3 py-2 text-right tabular-nums">
                {money(r.revenue_cents, cur)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportSection>
  )
}
