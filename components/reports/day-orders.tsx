import Link from "next/link"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatDateTime, money } from "@/lib/format"
import {
  BILL_STATUS_STYLE,
  ORDER_STATUS_STYLE,
  billStatusLabel,
  orderStatusLabel,
  orderTypeLabel,
} from "@/lib/order-constants"
import { cn } from "@/lib/utils"
import { ReportSection } from "./report-section"

/** The row shape `DayClosePage` selects. */
export type DayOrder = {
  id: string
  order_type: string
  status: string
  created_at: string
  guests: number | null
  bill_id: string | null
  restaurant_tables: { label: string } | null
  order_items: { qty: number; unit_price_cents: number; is_void: boolean }[]
  bills: { status: string } | null
}

/** Cap on the listing. A day past this wants the CSV, not a longer page. */
export const DAY_ORDER_LIMIT = 500

/**
 * An order's own non-void lines.
 *
 * Never `bills.total_cents` — `add_order_to_bill` merges tables, so one bill's
 * total appears on every order sharing it and summing the column would double
 * count. Same rule the POS Completed tab follows.
 */
function lineTotal(o: DayOrder): number {
  return (o.order_items ?? [])
    .filter((l) => !l.is_void)
    .reduce((sum, l) => sum + l.unit_price_cents * l.qty, 0)
}

function lineCount(o: DayOrder): number {
  return (o.order_items ?? []).filter((l) => !l.is_void).reduce((sum, l) => sum + l.qty, 0)
}

function destination(o: DayOrder): string {
  return o.restaurant_tables?.label ? `Table ${o.restaurant_tables.label}` : orderTypeLabel(o.order_type)
}

/**
 * Every order of the business day, under the totals it adds up to.
 *
 * The sheet above this reconciles the day; this is the ledger behind it — the
 * answer to "which order was that?" without leaving the page for the POS. Rows
 * are bounded by the same window the RPC used (`from`/`to` off its own payload),
 * so the list and the figures above cannot describe different days.
 */
export function DayOrders({
  orders,
  currency,
  timezone,
  truncated,
  revenueCents,
}: {
  orders: DayOrder[]
  currency: string
  timezone: string
  /** The cap was hit — say so rather than let a partial list read as complete. */
  truncated: boolean
  /** The day's settled revenue, only so the two can be told apart in words. */
  revenueCents: number
}) {
  const ordered = orders
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + lineTotal(o), 0)
  const rows = orders.map((o) => ({
    time: formatDateTime(o.created_at, timezone),
    order: o.id.slice(0, 8).toUpperCase(),
    destination: destination(o),
    guests: o.guests ?? "",
    items: lineCount(o),
    amount: money(lineTotal(o), currency),
    status: orderStatusLabel(o.status),
    bill: o.bills ? billStatusLabel(o.bills.status) : "No bill",
  }))

  return (
    <ReportSection
      title="Orders"
      rows={rows}
      columns={[
        { key: "time", label: "Time" },
        { key: "order", label: "Order" },
        { key: "destination", label: "Destination" },
        { key: "guests", label: "Guests" },
        { key: "items", label: "Items" },
        { key: "amount", label: "Amount" },
        { key: "status", label: "Status" },
        { key: "bill", label: "Bill" },
      ]}
      filename="day-close-orders"
      empty="No orders were taken on this day."
    >
      <Table className="w-full text-sm">
        <TableHeader className="bg-muted/50">
          <TableRow>
            {/* "Started", not "Closed": created_at is the only timestamp an
                order carries, and labelling it otherwise would be a lie. */}
            <TableHead className="px-3 py-2 font-medium">Started</TableHead>
            <TableHead className="px-3 py-2 font-medium">Order</TableHead>
            <TableHead className="px-3 py-2 font-medium">Destination</TableHead>
            <TableHead className="hidden px-3 py-2 text-right font-medium md:table-cell">
              Items
            </TableHead>
            <TableHead className="px-3 py-2 text-right font-medium">Amount</TableHead>
            <TableHead className="px-3 py-2 font-medium">Status</TableHead>
            <TableHead className="hidden px-3 py-2 font-medium md:table-cell">Bill</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => {
            const cancelled = o.status === "cancelled"
            return (
              <TableRow key={o.id}>
                <TableCell className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {formatDateTime(o.created_at, timezone)}
                </TableCell>
                <TableCell className="px-3 py-2 font-medium">
                  {o.bill_id ? (
                    <Link href={`/bill/${o.bill_id}`} className="hover:underline">
                      #{o.id.slice(0, 8).toUpperCase()}
                    </Link>
                  ) : (
                    <span>#{o.id.slice(0, 8).toUpperCase()}</span>
                  )}
                </TableCell>
                <TableCell className="px-3 py-2">
                  {destination(o)}
                  {o.guests ? (
                    <span className="text-muted-foreground"> · {o.guests} guests</span>
                  ) : null}
                </TableCell>
                <TableCell className="hidden px-3 py-2 text-right tabular-nums text-muted-foreground md:table-cell">
                  {lineCount(o)}
                </TableCell>
                <TableCell
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    cancelled && "text-muted-foreground line-through",
                  )}
                >
                  {money(lineTotal(o), currency)}
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Badge className={ORDER_STATUS_STYLE[o.status] ?? "bg-muted text-muted-foreground"}>
                    {orderStatusLabel(o.status)}
                  </Badge>
                </TableCell>
                <TableCell className="hidden px-3 py-2 md:table-cell">
                  {o.bills ? (
                    <Badge
                      className={BILL_STATUS_STYLE[o.bills.status] ?? "bg-muted text-muted-foreground"}
                    >
                      {billStatusLabel(o.bills.status)}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <div className="space-y-1 px-3 py-2 text-xs text-muted-foreground">
        {/* This column will not add up to Revenue, and a reader will try. Amount
            is what was ordered — menu prices of non-void lines, every order on
            the day whether or not anyone paid. Revenue is what was settled:
            paid bills only, at bill totals, after tax, service and discounts.
            Saying so is cheaper than the support ticket. */}
        <p>
          {orders.length} {orders.length === 1 ? "order" : "orders"} ·{" "}
          <span className="tabular-nums">{money(ordered, currency)}</span> ordered, excluding
          cancellations and voided lines.
        </p>
        {ordered !== revenueCents ? (
          <p>
            That is not the same figure as Revenue ({money(revenueCents, currency)}): this column
            is what was <em>ordered</em>, at menu prices, whether or not it was paid for. Revenue
            is what was <em>settled</em> — paid bills only, at bill totals, after tax, service and
            discounts.
          </p>
        ) : null}
        {truncated ? (
          <p>
            Showing the first {DAY_ORDER_LIMIT} orders of this day. Export the CSV for the rest.
          </p>
        ) : null}
      </div>
    </ReportSection>
  )
}
