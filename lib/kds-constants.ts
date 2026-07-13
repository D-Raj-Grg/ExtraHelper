/**
 * KOT ticket flow constants. Kept in a plain module (NOT the "use server"
 * actions file) — a "use server" module may only export async functions, so
 * exporting a const array from it breaks when imported into a Client Component.
 */
export const KOT_FLOW = ["new", "preparing", "ready", "served"] as const
export type KotStatus = (typeof KOT_FLOW)[number] | "recalled"

/**
 * Order lifecycle. KOT bumps drive in_kitchen→preparing→ready→served (see
 * sync_order_status_from_kots); billing drives served→billed→closed.
 */
export const ORDER_FLOW = [
  "draft",
  "placed",
  "in_kitchen",
  "preparing",
  "ready",
  "served",
  "billed",
  "closed",
] as const
export type OrderStatus = (typeof ORDER_FLOW)[number] | "cancelled"
