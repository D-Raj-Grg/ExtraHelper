"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import {
  ArmchairIcon,
  ClipboardListIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptIcon,
  ReceiptTextIcon,
  ShoppingBagIcon,
} from "lucide-react"

import { money, tzDayStart } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  billStatusLabel,
  BILL_STATUS_STYLE,
  orderStatusLabel,
  orderTypeLabel,
  ORDER_STATUS_STYLE,
} from "@/lib/order-constants"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { usePrint } from "@/components/print/use-print"
import { ChoiceChip } from "@/components/pos/choice-chip"
import { DaySummaryBar } from "@/components/pos/day-summary-bar"
import { Frame } from "@/components/pos/pos-empty-state"
import { RelativeTime } from "@/components/pos/relative-time"
import type { PosCompletedOrder } from "@/components/pos/types"

const ALL = "__all__"

const FILTERS: { key: string; label: string }[] = [
  { key: "billed", label: "Billed" },
  { key: "closed", label: "Closed" },
  { key: "cancelled", label: "Cancelled" },
]

/** Non-void lines only — a voided line was never sold. */
function lineTotal(o: PosCompletedOrder): number {
  return (o.order_items ?? [])
    .filter((l) => !l.is_void)
    .reduce((sum, l) => sum + l.unit_price_cents * l.qty, 0)
}

function lineCount(o: PosCompletedOrder): number {
  return (o.order_items ?? []).filter((l) => !l.is_void).reduce((sum, l) => sum + l.qty, 0)
}

/**
 * Can this row still take another line?
 *
 * Billed, with its bill still open — i.e. presented but not yet tendered. The
 * database enforces the same rule; this only decides whether to offer the
 * control. A `closed` order, or an open bill that has taken a part payment
 * (`partial`), is done.
 */
function canAmend(o: PosCompletedOrder): boolean {
  return o.status === "billed" && o.bills?.status === "open"
}

function destination(o: PosCompletedOrder): string {
  return o.restaurant_tables?.label ? `Table ${o.restaurant_tables.label}` : orderTypeLabel(o.order_type)
}

/**
 * Today's finished orders — the answer to "where did the one I just closed go?".
 *
 * A table, not the card grid: most affordances an OrderCard carries (pin, clear,
 * checkout) are meaningless once an order is billed. What's left is a row you
 * read, occasionally reprint, and — while the bill is still open — add to, which
 * is what a table with a couple of row actions is for.
 */
export function CompletedTab({
  orders,
  currency,
  timeZone,
  dayCutoffMinutes = 0,
  canCheckout,
  onGoToOrders,
  onAmend,
}: {
  orders: PosCompletedOrder[]
  currency: string
  timeZone: string
  /** Minutes past local midnight the trading day turns over — must match the query's. */
  dayCutoffMinutes?: number
  /** Holds checkout.view. The bill page and the print RPC enforce it server-side too. */
  canCheckout: boolean
  onGoToOrders: () => void
  /** Reopen the composer on a billed order whose bill hasn't been paid yet. */
  onAmend: (orderId: string) => void
}) {
  // Carried over: billed, unpaid, and opened on an earlier business day. Those
  // rows ignore the tab's day bound (see completedOrdersQuery) so the money
  // stays reachable, which means they must be labelled — an "earlier" row
  // counted into today's takings would misstate the day.
  const dayStart = useMemo(
    () => tzDayStart(new Date(), timeZone, dayCutoffMinutes).getTime(),
    [timeZone, dayCutoffMinutes],
  )
  const isEarlier = (o: PosCompletedOrder) => new Date(o.created_at).getTime() < dayStart

  const [filter, setFilter] = useState<string>(ALL)
  const [pending, startTransition] = useTransition()
  const { printReceipt } = usePrint()

  // How many orders share each bill. add_order_to_bill merges tables, so the
  // same bill total can appear on several rows — see the Amount column.
  const perBill = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of orders) {
      if (o.bill_id) m.set(o.bill_id, (m.get(o.bill_id) ?? 0) + 1)
    }
    return m
  }, [orders])

  if (orders.length === 0) {
    return (
      <Frame icon={<ReceiptTextIcon className="size-8 text-muted-foreground" aria-hidden />}>
        <p className="text-base font-semibold">Nothing completed yet today</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Orders land here the moment you bill or close them, so you can check one back after the
          guest has gone. Take one on the Orders tab, then hit Checkout.
        </p>
        <Button onClick={onGoToOrders} className="mt-1">
          <ClipboardListIcon />
          Go to Orders
        </Button>
      </Frame>
    )
  }

  const counts = new Map<string, number>()
  for (const o of orders) counts.set(o.status, (counts.get(o.status) ?? 0) + 1)

  // A filter whose status has no rows falls back to All rather than showing a
  // blank pane — same rule the Orders board follows.
  const active = filter !== ALL && counts.has(filter) ? filter : ALL
  const shown = active === ALL ? orders : orders.filter((o) => o.status === active)

  function reprint(billId: string) {
    startTransition(async () => {
      // These orders are done, so the paper wanted here is the receipt.
      await printReceipt(billId)
    })
  }

  return (
    <div className="space-y-4">
      {/* Reads `orders`, not `shown`: the chips filter the table, not the day. */}
      <DaySummaryBar
        orders={orders}
        currency={currency}
        cutoffMinutes={dayCutoffMinutes}
        dayStart={dayStart}
        lineTotal={lineTotal}
        counts={counts}
      />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">Completed orders</h3>
        <p className="text-sm text-muted-foreground tabular-nums">
          Showing {shown.length} {shown.length === 1 ? "order" : "orders"}
        </p>
      </div>

      <div role="radiogroup" aria-label="Filter by status" className="flex flex-wrap gap-2">
        <ChoiceChip
          name="pos-completed-filter"
          checked={active === ALL}
          onSelect={() => setFilter(ALL)}
          label="All"
          detail={`${orders.length} ${orders.length === 1 ? "order" : "orders"}`}
        />
        {FILTERS.filter((f) => counts.has(f.key)).map((f) => {
          const n = counts.get(f.key) ?? 0
          return (
            <ChoiceChip
              key={f.key}
              name="pos-completed-filter"
              checked={active === f.key}
              onSelect={() => setFilter(f.key)}
              label={f.label}
              detail={`${n} ${n === 1 ? "order" : "orders"}`}
            />
          )
        })}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {/* "Started", not "Closed": created_at is the only timestamp orders
                carry, and labelling it otherwise would be a lie on the page. */}
            <TableHead>Started</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Destination</TableHead>
            <TableHead className="hidden text-right md:table-cell">Items</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Bill</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((o) => {
            const cancelled = o.status === "cancelled"
            const merged = o.bill_id ? (perBill.get(o.bill_id) ?? 1) : 1
            const isTakeaway = !o.restaurant_tables
            return (
              <TableRow key={o.id}>
                <TableCell className="text-muted-foreground">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <RelativeTime iso={o.created_at} timeZone={timeZone} />
                    {isEarlier(o) ? (
                      <Badge
                        variant="outline"
                        className="border-orange-500/40 text-orange-700 dark:text-orange-400"
                      >
                        Earlier day
                      </Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  #{o.id.slice(0, 8).toUpperCase()}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    {isTakeaway ? (
                      <ShoppingBagIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <ArmchairIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    {destination(o)}
                  </span>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {cancelled ? "—" : lineCount(o)}
                </TableCell>
                {/* The order's OWN lines, never bills.total_cents: on a merged
                    bill that would repeat the same money on every row and read
                    as takings that were never taken. */}
                <TableCell className="text-right font-semibold tabular-nums">
                  {cancelled ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    money(lineTotal(o), currency)
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={cn("border-transparent", ORDER_STATUS_STYLE[o.status])}>
                    {orderStatusLabel(o.status)}
                  </Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {o.bills ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge className={cn("border-transparent", BILL_STATUS_STYLE[o.bills.status])}>
                        {billStatusLabel(o.bills.status)}
                      </Badge>
                      {merged > 1 ? (
                        // The bill total belongs to all of them, so it's shown
                        // on none of them — open the bill to see it.
                        <Badge variant="outline" className="tabular-nums">
                          Merged ×{merged}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {money(o.bills.total_cents, currency)}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      <span aria-hidden>—</span>
                      <span className="sr-only">No bill — this order was cancelled</span>
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    {/* One more water bottle after the bill went out. Allowed
                        only while nothing has been tendered — once the bill is
                        paid the RPC refuses, and the answer is a new order. */}
                    {canAmend(o) ? (
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() => onAmend(o.id)}
                      >
                        <PlusIcon />
                        Add items
                        <span className="sr-only"> to {destination(o)}</span>
                      </Button>
                    ) : null}
                    {/* No permission, no bill ⇒ nothing rather than a disabled
                        control: a waiter can't act on it and an unexplained
                        greyed-out button is just noise on a busy screen. */}
                    {canCheckout && o.bill_id ? (
                      <>
                        <Button
                          variant="outline"
                          nativeButton={false}
                          render={<Link href={`/bill/${o.bill_id}`} />}
                          className="min-h-11"
                        >
                          <ReceiptIcon />
                          View bill
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-11"
                          disabled={pending}
                          aria-label={`Reprint receipt for ${destination(o)}`}
                          onClick={() => reprint(o.bill_id as string)}
                        >
                          <PrinterIcon />
                        </Button>
                      </>
                    ) : null}
                  </span>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
