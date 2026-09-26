import Link from "next/link"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PAID_FROM, PAID_FROM_LABELS } from "@/lib/expense-constants"
import { money } from "@/lib/format"
import { delta } from "@/lib/report-range"
import { ReportEmpty, ReportSection } from "./report-section"
import { StatTiles } from "./stat-tiles"
import type { ReportCtx, Sales } from "./types"

type ExpenseReport = {
  from_day: string
  to_day: string
  total_cents: number
  count: number
  by_paid_from: { cash: number; online: number; owner: number }
  by_category: { name: string; amount_cents: number; count: number }[]
  by_day: { day: string; day_label: string; amount_cents: number; count: number }[]
}

const EMPTY: ExpenseReport = {
  from_day: "",
  to_day: "",
  total_cents: 0,
  count: 0,
  by_paid_from: { cash: 0, online: 0, owner: 0 },
  by_category: [],
  by_day: [],
}

/**
 * What the range cost to run, next to what it took. Expenses are bucketed by
 * business day (`report_expenses`), so a week here sums the same days Day
 * close shows one at a time. Revenue comes from `report_sales`, the Sales tab's
 * own figure, so "net" is revenue minus expenses with nothing re-derived.
 */
export async function ExpensesTab({
  supabase,
  tenantId,
  F,
  T,
  PF,
  PT,
  cur,
}: ReportCtx & { PF: string; PT: string }) {
  const [cur1, prev1, sales] = await Promise.all([
    supabase.rpc("report_expenses", { _tenant: tenantId, _from: F, _to: T }),
    supabase.rpc("report_expenses", { _tenant: tenantId, _from: PF, _to: PT }),
    supabase.rpc("report_sales", { _tenant: tenantId, _from: F, _to: T }),
  ])

  const c = (cur1.data as unknown as ExpenseReport | null) ?? EMPTY
  const p = (prev1.data as unknown as ExpenseReport | null) ?? EMPTY
  const s: Pick<Sales, "revenue_cents"> = sales.data?.[0] ?? { revenue_cents: 0 }
  const net = s.revenue_cents - c.total_cents
  const share = s.revenue_cents > 0 ? `${((c.total_cents / s.revenue_cents) * 100).toFixed(1)}%` : "—"

  return (
    <div className="flex flex-col gap-6">
      <StatTiles
        tiles={[
          {
            label: "Expenses",
            value: money(c.total_cents, cur),
            delta: delta(c.total_cents, p.total_cents),
            lowerIsBetter: true,
          },
          { label: "Revenue", value: money(s.revenue_cents, cur) },
          { label: "Net after expenses", value: money(net, cur), warn: net < 0 },
          { label: "Expenses / revenue", value: share },
          { label: "Entries", value: String(c.count) },
          ...PAID_FROM.map((k) => ({
            label: `Paid from ${PAID_FROM_LABELS[k].toLowerCase()}`,
            value: money(c.by_paid_from[k], cur),
          })),
        ]}
      />

      {c.count === 0 ? (
        <ReportEmpty>
          No expenses logged in this period. Staff add them on the Expenses page as they spend, and
          they show up here by day and category.
        </ReportEmpty>
      ) : null}

      <ReportSection
        title="By category"
        rows={c.by_category.map((x) => ({
          category: x.name,
          entries: x.count,
          amount: money(x.amount_cents, cur),
        }))}
        columns={[
          { key: "category", label: "Category" },
          { key: "entries", label: "Entries" },
          { key: "amount", label: "Amount" },
        ]}
        filename="expenses-by-category"
        empty="Nothing to break down."
      >
        <Table className="w-full text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-3 py-2 font-medium">Category</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Entries</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Amount</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {c.by_category.map((x) => (
              <TableRow key={x.name}>
                <TableCell className="px-3 py-2">{x.name}</TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {x.count}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums">
                  {money(x.amount_cents, cur)}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {c.total_cents > 0
                    ? `${((x.amount_cents / c.total_cents) * 100).toFixed(0)}%`
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ReportSection>

      <ReportSection
        title="By day"
        rows={c.by_day.map((x) => ({
          date: x.day_label,
          entries: x.count,
          amount: money(x.amount_cents, cur),
        }))}
        columns={[
          { key: "date", label: "Date" },
          { key: "entries", label: "Entries" },
          { key: "amount", label: "Amount" },
        ]}
        filename="expenses-by-day"
        empty="No expenses on any day in this period."
      >
        <Table className="w-full text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-3 py-2 font-medium">Date</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Entries</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {c.by_day.map((x) => (
              <TableRow key={x.day}>
                <TableCell className="px-3 py-2 whitespace-nowrap">
                  <Link href={`/expenses?date=${x.day}`} className="hover:underline">
                    {x.day_label}
                  </Link>
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {x.count}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums">
                  {money(x.amount_cents, cur)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ReportSection>
    </div>
  )
}
