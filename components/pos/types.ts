import type { CachedCategory, CachedFloor, CachedMenuItem, CachedTable } from "@/lib/offline/menu-cache"

// The POS renders from the offline cache shape whether or not it's offline, so
// there is exactly one menu/table type in play rather than a server one and a
// cached one that drift.
export type PosMenuItem = CachedMenuItem
export type PosTable = CachedTable
export type PosCategory = CachedCategory
export type PosFloor = CachedFloor

export type PosCustomer = { id: string; name: string | null; phone: string | null }
export type PosStaff = { user_id: string; name: string }

/** Sentinel for "no table" — an empty value keeps it usable as a radio value. */
export const TAKEAWAY = ""

/** One line as shown on an order card in the grid. */
export type PosCardLine = {
  id: string
  name_snapshot: string
  qty: number
  unit_price_cents: number
  is_void: boolean
}

/** An active order, as the grid needs it. */
export type PosOrderCard = {
  id: string
  order_type: string
  status: string
  created_at: string
  guests: number | null
  table_id: string | null
  restaurant_tables: { label: string } | null
  order_items: PosCardLine[]
}

/** A modifier line as the KOT tab shows it. */
export type PosKotMod = { name_snapshot: string; qty: number }

/** One line on a kitchen ticket. */
export type PosKotLine = {
  id: string
  qty: number
  order_items: {
    id: string
    name_snapshot: string
    is_void: boolean
    notes: string | null
    order_item_modifiers: PosKotMod[] | null
  } | null
}

/** A kitchen ticket, as the POS KOT tab renders it. */
export type PosKot = {
  id: string
  status: string
  created_at: string
  printed_at: string | null
  station_id: string | null
  order_id: string | null
  kitchen_stations: { name: string } | null
  orders: {
    order_type: string
    status: string
    waiter_id: string | null
    restaurant_tables: { label: string } | null
  } | null
  kot_items: PosKotLine[]
}

/** A modifier recorded on a placed line. */
export type PosDetailMod = {
  modifier_id: string | null
  name_snapshot: string
  price_cents: number
}

/** A placed line, with everything amend mode needs to edit it. */
export type PosDetailLine = {
  id: string
  item_id: string | null
  variant_id: string | null
  name_snapshot: string
  qty: number
  unit_price_cents: number
  status: string
  is_void: boolean
  is_held: boolean
  notes: string | null
  course: number | null
  seat: number | null
  order_item_modifiers: PosDetailMod[]
}

/** A single order opened for amending. */
export type PosOrderDetail = {
  id: string
  status: string
  order_type: string
  table_id: string | null
  guests: number | null
  waiter_id: string | null
  customer_id: string | null
  bill_id: string | null
  restaurant_tables: { label: string } | null
  order_items: PosDetailLine[]
}

/** Everything both POS surfaces render from. */
export type PosData = {
  menu: PosMenuItem[]
  tables: PosTable[]
  floors: PosFloor[]
  categories: PosCategory[]
  customers: PosCustomer[]
  staff: PosStaff[]
  orders: PosOrderCard[]
  kots: PosKot[]
}
