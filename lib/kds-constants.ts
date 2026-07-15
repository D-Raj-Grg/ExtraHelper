/**
 * KOT ticket flow constants. Kept in a plain module (NOT the "use server"
 * actions file) — a "use server" module may only export async functions, so
 * exporting a const array from it breaks when imported into a Client Component.
 */
export const KOT_FLOW = ["new", "preparing", "ready", "served"] as const
export type KotStatus = (typeof KOT_FLOW)[number] | "recalled"

/** Ticket status in plain English — the kitchen never sees a raw enum. */
const KOT_STATUS_LABEL: Record<string, string> = {
  new: "New",
  preparing: "Cooking",
  ready: "Ready",
  served: "Served",
  recalled: "Recalled",
}

export function kotStatusLabel(status: string): string {
  return KOT_STATUS_LABEL[status] ?? status
}

export const KOT_STATUS_STYLE: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  preparing: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ready: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  served: "bg-muted text-muted-foreground",
  recalled: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
}

/**
 * How long a ticket has been open, as a tone the whole board agrees on.
 * The age is stated in words as well as colour — a kitchen screen is read at a
 * distance, often by someone colourblind, and "the red one" is not a spec.
 */
export type AgeTone = { border: string; text: string; label: string; late: boolean }

export function ticketAge(createdAt: string, now: number): AgeTone {
  const mins = Math.floor((now - new Date(createdAt).getTime()) / 60000)
  const label = mins <= 0 ? "just now" : `${mins}m`
  if (mins < 5)
    return { border: "border-emerald-500/60", text: "text-emerald-700 dark:text-emerald-400", label, late: false }
  if (mins < 10)
    return { border: "border-amber-500/70", text: "text-amber-700 dark:text-amber-400", label, late: false }
  return { border: "border-destructive", text: "text-destructive", label, late: true }
}

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
