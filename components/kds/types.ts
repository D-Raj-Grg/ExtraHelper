/**
 * The board's row shape — what KDS_SELECT (lib/kds-constants.ts) returns.
 * A plain module so the board, the ticket card and the dish rail all agree
 * without importing each other.
 */
export type KdsStation = { id: string; name: string }

export type KdsLine = {
  id: string
  qty: number
  status: string
  order_items: {
    id: string
    name_snapshot: string
    is_void: boolean
    void_reason: string | null
    notes: string | null
    order_item_modifiers: { name_snapshot: string; qty: number }[]
  } | null
}

export type KdsKot = {
  id: string
  status: string
  created_at: string
  printed_at: string | null
  station_id: string | null
  order_id: string | null
  kitchen_stations: { name: string } | null
  orders: {
    status: string
    restaurant_tables: { label: string } | null
  } | null
  kot_items: KdsLine[]
}

/** Once an order is billed/closed a void can't recompute a paid bill. */
export const UNVOIDABLE_ORDER_STATUSES = ["billed", "closed", "cancelled"]

/** True when this line is still live (not voided by a manager). */
export function isLive(line: KdsLine): boolean {
  return !line.order_items?.is_void
}
