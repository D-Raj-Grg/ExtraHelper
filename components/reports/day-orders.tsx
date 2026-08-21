import { formatDateTime, money } from "@/lib/format"
import { billStatusLabel, orderStatusLabel } from "@/lib/order-constants"
import { ReportSection } from "./report-section"
import { DayOrdersTable, destination, lineCount, lineTotal } from "./day-orders-table"

/** The row shape `DayClosePage` selects. */
export type DayOrder = {
  id: string
  order_type: string
  status: string
  created_at: string
  guests: number | null
  bill_id: string | null
  restaurant_tables: { label: string } | null
  order_items: {
    id: string
    name_snapshot: string
    qty: number
    unit_price_cents: number
    is_void: boolean
    notes: string | null
  }[]
  bills: { status: string; total_cents: number } | null
}

/** Cap on the listing. A day past this wants the CSV, not a longer page. */
export const DAY_ORDER_LIMIT = 500

/**
 * Every order of the business day, under the totals it adds up to.
 *
 * The sheet above this reconciles the day; this is the ledger behind it — the
 * answer to "which order was that?" without leaving the page for the POS. Rows
 * are bounded by the same window the RPC used (`from`/`to` off its own payload),
 * so the list and the figures above cannot describe different days.
 *
 * Stays a Server Component so `ReportSection` (and the CSV it builds) does not
 * get dragged into the browser bundle; only the table itself, which needs click
 * state for the detail sheet, is a client island.
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
        { key: "time", label: "Started" },
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
      <DayOrdersTable orders={orders} currency={currency} timezone={timezone} />

      <div className="space-y-1 px-3 py-2 text-xs text-muted-foreground">
        {/* This column will not add up to Revenue, and a reader will try. Amount
            is what was ordered — menu prices of non-void lines, every order on
            the day whether or not anyone paid. Revenue is what was settled:
            paid bills only, at bill totals, after tax, service and discounts.
            Saying so is cheaper than the support ticket. */}
        <p>
          {orders.length} {orders.length === 1 ? "order" : "orders"} ·{" "}
          <span className="tabular-nums">{money(ordered, currency)}</span> ordered, excluding
          cancellations and voided lines. Select a row for its items.
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
