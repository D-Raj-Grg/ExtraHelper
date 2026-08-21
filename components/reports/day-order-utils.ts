/**
 * Shape and arithmetic for one order on the day-close list.
 *
 * A PLAIN module, and that is the whole point of it existing. The list is a
 * Server Component (so `ReportSection` and the CSV builder stay off the client)
 * while the table is a client island (it owns the detail sheet's open state).
 * Both need these functions.
 *
 * Exporting them from the `"use client"` file instead does not work, and fails
 * only at render: every export of a client module becomes a *client reference*
 * when a Server Component imports it, so calling one on the server throws
 * "Attempted to call a temporary Client Reference from the server". tsc and
 * `next build` both pass, and the page 500s on every date. Same family as the
 * rule already in CLAUDE.md about client components importing server-only
 * modules — this is that boundary crossed in the other direction.
 */

import { orderTypeLabel } from "@/lib/order-constants"

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
 * An order's own non-void lines.
 *
 * Never `bills.total_cents` — `add_order_to_bill` merges tables, so one bill's
 * total appears on every order sharing it and summing the column would double
 * count. Same rule the POS Completed tab follows.
 */
export function lineTotal(o: DayOrder): number {
  return (o.order_items ?? [])
    .filter((l) => !l.is_void)
    .reduce((sum, l) => sum + l.unit_price_cents * l.qty, 0)
}

export function lineCount(o: DayOrder): number {
  return (o.order_items ?? []).filter((l) => !l.is_void).reduce((sum, l) => sum + l.qty, 0)
}

export function destination(o: DayOrder): string {
  return o.restaurant_tables?.label
    ? `Table ${o.restaurant_tables.label}`
    : orderTypeLabel(o.order_type)
}

export function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase()
}
