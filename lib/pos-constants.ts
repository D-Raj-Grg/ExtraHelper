/**
 * Shared POS query shape.
 *
 * A plain module on purpose, like table-constants and order-constants: the
 * server page and the client's Realtime refetch must issue the *same* select,
 * but the client can't import it from app/(app)/pos/data.ts — that file pulls
 * in lib/supabase/server, and with it next/headers, which doesn't build in a
 * browser bundle. Constants live here so both sides can share them.
 *
 * If these two diverge, the first Realtime ping visibly strips the order cards.
 */

/**
 * The !orders_table_id_fkey hint is load-bearing: orders has two FKs to
 * restaurant_tables and PostgREST can't choose between them on its own.
 */
export const ORDER_CARD_SELECT =
  "id, order_type, status, created_at, guests, table_id, " +
  "restaurant_tables!orders_table_id_fkey(label), " +
  "order_items(id, name_snapshot, qty, unit_price_cents, is_void)"

/**
 * KOT ticket shape for the POS KOT tab. Shared server+client like the order
 * selects — the client's Realtime refetch must issue the same select, and it
 * can't import it from data.ts (that pulls next/headers). orders!inner drops any
 * ticket whose parent order was hard-deleted rather than rendering a headless
 * card. waiter_id resolves to a name against the staff list already in PosData.
 */
export const KOT_CARD_SELECT =
  "id, status, created_at, printed_at, station_id, order_id, " +
  "kitchen_stations(name), " +
  "orders!inner(order_type, status, waiter_id, restaurant_tables!orders_table_id_fkey(label)), " +
  "kot_items(id, qty, order_items(id, name_snapshot, is_void, notes, order_item_modifiers(name_snapshot, qty)))"

/** KOT statuses the POS tab pulls — active plus served (served hidden until the toggle). */
export const KOT_TAB_STATUSES = ["new", "preparing", "ready", "served"]

export const ORDER_DETAIL_SELECT =
  "id, status, order_type, table_id, guests, waiter_id, customer_id, bill_id, " +
  "restaurant_tables!orders_table_id_fkey(label), " +
  "order_items(id, item_id, variant_id, name_snapshot, qty, unit_price_cents, status, " +
  "is_void, is_held, notes, course, seat, " +
  "order_item_modifiers(modifier_id, name_snapshot, price_cents))"

/** Orders the POS board shows — everything not yet billed or closed. */
export const ACTIVE_ORDER_STATUSES = [
  "draft",
  "placed",
  "in_kitchen",
  "preparing",
  "ready",
  "served",
]
