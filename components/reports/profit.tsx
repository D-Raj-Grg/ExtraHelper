import Link from "next/link"
import { CalculatorIcon } from "lucide-react"

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

/**
 * The profit-side pieces the Sales tab and the Day close sheet share.
 *
 * A plain module (no "use client"): both consumers are Server Components and
 * `ReportSection` builds their CSVs on the server. Every figure here is null
 * when the caller lacks `profit.view`, and the UI renders nothing for that —
 * a missing permission is not a zero.
 */

/** Where the money went, per sold item. Cost/profit null ⇒ "—". */
export type TopItemLike = {
  description: string
  qty: number
  revenue_cents: number
  cost_cents?: number | null
  profit_cents?: number | null
}

/** "62.5%" — margin arrives from the RPC already ×100 at one decimal. */
export function marginLabel(pct: number | null | undefined): string {
  return pct == null ? "—" : `${Number(pct).toFixed(1)}%`
}

/**
 * `showProfit` is the caller's profit.view, passed explicitly — never derived
 * from the rows. A permitted viewer whose every item is uncosted still gets
 * the Cost/Profit columns (as "—"), which is the same answer the orders table
 * gives, and what tells them costing is the thing to fix.
 */
export function topItemRows(items: TopItemLike[], cur: string, showProfit: boolean) {
  return items.map((t) => ({
    item: t.description,
    qty: Number(t.qty),
    revenue: money(t.revenue_cents, cur),
    ...(showProfit
      ? {
          cost: t.cost_cents == null ? "—" : money(t.cost_cents, cur),
          profit: t.profit_cents == null ? "—" : money(t.profit_cents, cur),
        }
      : {}),
  }))
}

export function topItemColumns(showProfit: boolean): CsvColumn[] {
  return [
    { key: "item", label: "Item" },
    { key: "qty", label: "Qty" },
    { key: "revenue", label: "Revenue" },
    ...(showProfit
      ? [
          { key: "cost", label: "Cost" },
          { key: "profit", label: "Profit" },
        ]
      : []),
  ]
}

export function TopItemsTable({
  items,
  cur,
  showProfit,
}: {
  items: TopItemLike[]
  cur: string
  showProfit: boolean
}) {
  return (
    <Table className="w-full text-sm">
      <TableHeader className="bg-muted/50">
        <TableRow>
          <TableHead className="px-3 py-2 font-medium">Item</TableHead>
          <TableHead className="px-3 py-2 text-right font-medium">Qty</TableHead>
          <TableHead className="px-3 py-2 text-right font-medium">Revenue</TableHead>
          {showProfit ? (
            <>
              <TableHead className="px-3 py-2 text-right font-medium">Cost</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Profit</TableHead>
            </>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((t) => (
          <TableRow key={t.description}>
            <TableCell className="px-3 py-2">{t.description}</TableCell>
            <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
              {Number(t.qty)}
            </TableCell>
            <TableCell className="px-3 py-2 text-right tabular-nums">
              {money(t.revenue_cents, cur)}
            </TableCell>
            {showProfit ? (
              <>
                <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {t.cost_cents == null ? "—" : money(t.cost_cents, cur)}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums">
                  {t.profit_cents == null ? "—" : money(t.profit_cents, cur)}
                </TableCell>
              </>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * Sold lines with no cost snapshot. The profit figures leave them out, so
 * the reader is told where the number is short and where to fix it.
 */
export function UncostedHint({ n }: { n: number | null | undefined }) {
  if (!n || n <= 0) return null
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <CalculatorIcon className="size-3.5 shrink-0" aria-hidden />
      <span>
        {n} sold {n === 1 ? "line" : "lines"} had no cost — profit here counts only the lines that
        have one. Enter costs in{" "}
        <Link href="/inventory?tab=costing" className="font-medium text-foreground hover:underline">
          Inventory → Costing
        </Link>
        .
      </span>
    </p>
  )
}
