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
import type { SupabaseClient } from "@supabase/supabase-js"

import { KOT_ACTIVE_STATUSES } from "@/lib/kds-constants"
import { tzDayStart } from "@/lib/format"

/**
 * The !orders_table_id_fkey hint is load-bearing: orders has two FKs to
 * restaurant_tables and PostgREST can't choose between them on its own.
 */
export const ORDER_CARD_SELECT =
  "id, order_type, status, created_at, pinned_at, guests, table_id, " +
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
export const KOT_TAB_STATUSES = [...KOT_ACTIVE_STATUSES, "served"]

/**
 * The amend screen's shape. Carries the bill's own status, not just bill_id:
 * a billed order whose bill is still open can take more items (the database
 * says so), and without the status the client can't tell unpaid from settled
 * and has to refuse every add. FK hint spelled out for the same reason
 * COMPLETED_ORDER_SELECT spells it out.
 */
export const ORDER_DETAIL_SELECT =
  "id, status, order_type, table_id, guests, waiter_id, customer_id, bill_id, " +
  "restaurant_tables!orders_table_id_fkey(label), " +
  "bills!orders_bill_id_fkey(id, status), " +
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

/**
 * The other end of the lifecycle: nothing more will be cooked, priced or fired.
 * These leave the board and land on the Completed tab — which is the only place
 * in the app an order can be looked at again once it's paid for.
 */
export const ORDER_DONE_STATUSES = ["billed", "closed", "cancelled"]

/**
 * The Completed tab's shape — the card select plus the bill's own status and
 * total. The cashier's question is "did that one get paid?", and a second round
 * trip per row to answer it is not a POS.
 *
 * The FK hint is spelled out for the same reason the tables one is: an implicit
 * embed breaks the day a second FK to bills appears.
 */
export const COMPLETED_ORDER_SELECT =
  "id, order_type, status, created_at, guests, table_id, bill_id, " +
  "restaurant_tables!orders_table_id_fkey(label), " +
  "order_items(id, name_snapshot, qty, unit_price_cents, is_void), " +
  "bills!orders_bill_id_fkey(id, status, total_cents)"

/**
 * A busy till closes a few hundred orders a day. Caps the worst case without a
 * pager; a tenant that hits it wants /reports, not a bigger POS query.
 */
export const COMPLETED_ORDER_LIMIT = 300

/** Same idea for kitchen tickets — see kotTabQuery. */
export const KOT_TAB_LIMIT = 400

/**
 * Orders whose tickets are history: the money is in, or the order was
 * abandoned. Nothing more will be cooked for either.
 *
 * Deliberately NOT `ORDER_DONE_STATUSES` — that includes `billed`, and `billed`
 * no longer means anyone paid. A table can ask for the bill and then order one
 * more round; that fires a fresh ticket onto an order sitting at `billed`, and
 * counting it as history hides live work from the people who have to cook it.
 * `closed` is the status that means paid, and it is the one that belongs here.
 */
export const KOT_HISTORY_ORDER_STATUSES = ["closed", "cancelled"]

/**
 * A ticket is done when the kitchen bumped it, or its order is closed or
 * cancelled. The order half still matters: a `ready` ticket on a settled bill
 * is history, and without it that ticket sat on the active board forever.
 */
export function isKotCompleted(kot: {
  status: string
  orders: { status: string } | null
}): boolean {
  return (
    kot.status === "served" ||
    KOT_HISTORY_ORDER_STATUSES.includes(kot.orders?.status ?? "")
  )
}

/**
 * Today's finished orders, in the tenant's own day.
 *
 * A builder rather than a select string because the server page and the
 * client's Realtime refetch must issue the *identical* query — the failure this
 * whole module exists to prevent (see the header). Sharing the string still let
 * the two filters drift; sharing the query can't.
 *
 * Bounded on created_at: it's the indexed column
 * (idx_orders_tenant(tenant_id, created_at desc)) and orders has no closed_at.
 * Known consequence — an order opened 23:50 and billed 00:10 lists under the
 * previous day. Fixing that properly means a closed_at column and index.
 *
 * The one exception to the day bound is `billed`: that status means the bill
 * went out and nobody has paid yet (`closed` is the paid one), and the board
 * drops those orders. Day-bounding them too made an unpaid table that survived
 * midnight unreachable in the whole app — the table sat on `bill_requested`
 * with no way back to its bill. Unpaid money is never yesterday's problem, so
 * those rows carry over regardless of date; the tab tags them as earlier.
 */
export function completedOrdersQuery(
  supabase: SupabaseClient,
  tenantId: string,
  timeZone: string,
  now: Date = new Date(),
) {
  return supabase
    .from("orders")
    .select(COMPLETED_ORDER_SELECT)
    .eq("tenant_id", tenantId)
    .in("status", ORDER_DONE_STATUSES)
    .or(`status.eq.billed,created_at.gte.${tzDayStart(now, timeZone).toISOString()}`)
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "order_items" })
    .limit(COMPLETED_ORDER_LIMIT)
}

/**
 * The KOT tab's tickets, shared server+client for the same reason.
 *
 * Active tickets are never date-bound — one fired at 23:55 is still the
 * kitchen's problem at 00:05 — but the finished tail is capped to today, which
 * is what stops this query growing for the life of the tenant.
 */
export function kotTabQuery(
  supabase: SupabaseClient,
  tenantId: string,
  timeZone: string,
  now: Date = new Date(),
) {
  const since = tzDayStart(now, timeZone).toISOString()
  return supabase
    .from("kots")
    .select(KOT_CARD_SELECT)
    .eq("tenant_id", tenantId)
    .in("status", KOT_TAB_STATUSES)
    .or(`status.in.(${KOT_ACTIVE_STATUSES.join(",")}),created_at.gte.${since}`)
    .order("created_at", { ascending: false })
    .limit(KOT_TAB_LIMIT)
}
