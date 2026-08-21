"use client"

import { useMemo } from "react"
import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { money } from "@/lib/format"
import { paymentMethodLabel } from "@/lib/payment-constants"
import { cutoffLabel } from "@/components/reports/day-report"
import type { PosCompletedOrder } from "@/components/pos/types"

/**
 * The day's shape, above the Completed list.
 *
 * Computed from the rows already on screen rather than fetched: a second query
 * would be a second source of truth for "today's takings", and the Realtime
 * refetch replaces `orders` wholesale, so a memo keyed on it is correct after
 * every live ping with no extra wiring.
 *
 * The totals describe the DAY, not the filter. The status chips below filter
 * the table; a figure that moved when you tapped "Cancelled" would be
 * answering a different question from the one the heading asks.
 */
export function DaySummaryBar({
  orders,
  currency,
  cutoffMinutes,
  dayStart,
  lineTotal,
  counts,
}: {
  orders: PosCompletedOrder[]
  currency: string
  cutoffMinutes: number
  /**
   * Start of the business day, in ms. A number rather than the tab's
   * `isEarlier` predicate on purpose: that is an inline arrow, so a new identity
   * every render, and the memo below would never once hit.
   */
  dayStart: number
  /** An order's own non-void lines — never bills.total_cents. Module scope, so stable. */
  lineTotal: (o: PosCompletedOrder) => number
  counts: Map<string, number>
}) {
  const { takings, carried, split } = useMemo(() => {
    let takings = 0
    let carried = 0
    // add_order_to_bill merges tables, so one bill's payments come back on every
    // order that shares it. Collect by bill id first, or a merged table's card
    // payment is counted once per seat group.
    const byBill = new Map<string, { method: string; amount_cents: number; status: string }[]>()

    for (const o of orders) {
      const earlier = new Date(o.created_at).getTime() < dayStart
      if (earlier) carried += 1
      if (o.status !== "cancelled" && !earlier) takings += lineTotal(o)
      if (o.bill_id && o.bills?.payments && !byBill.has(o.bill_id)) {
        byBill.set(o.bill_id, o.bills.payments)
      }
    }

    const totals = new Map<string, number>()
    for (const rows of byBill.values()) {
      for (const p of rows) {
        if (p.status !== "completed") continue
        totals.set(p.method, (totals.get(p.method) ?? 0) + p.amount_cents)
      }
    }

    return {
      takings,
      carried,
      split: [...totals.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [orders, dayStart, lineTotal])

  const cut = cutoffLabel(cutoffMinutes)
  const billed = counts.get("billed") ?? 0
  const closed = counts.get("closed") ?? 0
  const cancelled = counts.get("cancelled") ?? 0

  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-xs text-muted-foreground">
            {cut ? `Takings since ${cut}` : "Takings today"}
          </p>
          <p className="text-2xl font-semibold tabular-nums">{money(takings, currency)}</p>
        </div>

        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <Stat label="Billed" value={billed} />
          <Stat label="Closed" value={closed} />
          <Stat label="Cancelled" value={cancelled} />
          {carried > 0 ? <Stat label="Carried over" value={carried} warn /> : null}
        </dl>

        {split.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {split.map(([method, cents]) => (
              <Badge key={method} variant="secondary" className="tabular-nums">
                {paymentMethodLabel(method)} {money(cents, currency)}
              </Badge>
            ))}
          </div>
        ) : null}

        <Link
          href="/reports/day"
          className="flex items-center gap-1 text-sm font-medium hover:underline"
        >
          Day close sheet
          <ArrowRightIcon className="size-4" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          warn
            ? "font-medium tabular-nums text-amber-600 dark:text-amber-400"
            : "font-medium tabular-nums"
        }
      >
        {value}
      </dd>
    </div>
  )
}
