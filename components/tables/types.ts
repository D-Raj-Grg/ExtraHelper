export type Floor = { id: string; name: string }

export type Table = {
  id: string
  label: string
  capacity: number
  state: string
  qr_token: string
  floor_id: string | null
  pos_x: number | null
  pos_y: number | null
  shape: string | null
  current_order_id: string | null
}

export type OrderItem = {
  id: string
  name_snapshot: string
  qty: number
  unit_price_cents: number
  is_void: boolean
}

export type ActiveOrder = {
  id: string
  table_id: string | null
  status: string
  order_items: OrderItem[]
}

/** Sentinel floor ids for the "no floor assigned" bucket and the map's all-floors view. */
export const NO_FLOOR = "__none__"
export const ALL_FLOORS = "__all__"
/** Split target meaning "don't seat it — make a new takeaway order". */
export const NEW_TAKEAWAY = "__new__"

/**
 * A table is actionable when it holds an order. The order list is the truth;
 * the state flags cover a table marked occupied before its order is keyed in.
 */
export function hasActiveOrder(t: Table, orderByTable: Map<string, ActiveOrder>): boolean {
  return orderByTable.has(t.id) || t.state === "occupied" || t.state === "bill_requested"
}
