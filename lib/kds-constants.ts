/**
 * KOT ticket flow constants. Kept in a plain module (NOT the "use server"
 * actions file) — a "use server" module may only export async functions, so
 * exporting a const array from it breaks when imported into a Client Component.
 */
export const KOT_FLOW = ["new", "preparing", "ready", "served"] as const
export type KotStatus = (typeof KOT_FLOW)[number] | "recalled"

/**
 * Tickets still on the board.
 *
 * `recalled` belongs here: `recall_kot` writes it (the action used to write
 * `preparing`, which made the value unreachable), and a recalled ticket is
 * precisely one the kitchen has been asked to look at again. Leave it out of a
 * filter and pulling a ticket back makes it disappear.
 */
export const KOT_ACTIVE_STATUSES = ["new", "preparing", "ready", "recalled"]

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
 * Everything a surface needs to render a status, in one place — the line
 * button, the filter chip, the dish rail and the status dialog all read this so
 * they can't drift. `icon` is a lucide *name* the client maps to a component:
 * this module is imported by the server page too, and shipping JSX from here
 * would drag React into it. Colour is never the only carrier — every consumer
 * pairs `style` with `icon` + `label`, so the board survives grayscale.
 */
export type KotStatusMeta = {
  label: string
  /** lucide icon name — see KOT_STATUS_ICON in components/kds/status-icon.tsx */
  icon: "clock" | "flame" | "bell" | "check" | "undo"
  style: string
  /** What this status means to a cook, for the status dialog. */
  hint: string
  /** Verb on the one-tap button that moves a line *into* this status. */
  action: string
  /** Text-only hue, for places that can't carry the full badge fill. */
  tone: string
}

export const KOT_STATUS_META: Record<KotStatus, KotStatusMeta> = {
  new: {
    label: "New",
    icon: "clock",
    style: KOT_STATUS_STYLE.new,
    hint: "Waiting on the kitchen",
    action: "Reset",
    tone: "text-blue-700 dark:text-blue-400",
  },
  preparing: {
    label: "Cooking",
    icon: "flame",
    style: KOT_STATUS_STYLE.preparing,
    hint: "On the pass right now",
    action: "Start",
    tone: "text-amber-700 dark:text-amber-400",
  },
  ready: {
    label: "Ready",
    icon: "bell",
    style: KOT_STATUS_STYLE.ready,
    hint: "Plated, waiting for pickup",
    action: "Ready",
    tone: "text-emerald-700 dark:text-emerald-400",
  },
  served: {
    label: "Served",
    icon: "check",
    style: KOT_STATUS_STYLE.served,
    hint: "Delivered to the guest",
    action: "Served",
    tone: "text-muted-foreground",
  },
  // A real status since recall_kot started writing it. Without a row here the
  // icon fell back to an X, which reads as "cancelled" — the opposite of a
  // ticket the kitchen has been asked to look at again.
  recalled: {
    label: "Recalled",
    icon: "undo",
    style: KOT_STATUS_STYLE.recalled,
    hint: "Pulled back onto the board",
    action: "Recall",
    tone: "text-orange-700 dark:text-orange-400",
  },
}

/** Status metadata for any status string, `recalled` included. */
export function kotStatusMeta(status: string): KotStatusMeta | undefined {
  return KOT_STATUS_META[status as keyof typeof KOT_STATUS_META]
}

/** Next status in the bump flow, or null if terminal. */
export function nextKotStatus(status: string): KotStatus | null {
  // Recalled is not a step in the flow — it is "back on the pass", so it
  // advances to ready. Without this the advance button vanishes and a recalled
  // ticket is stranded on the board.
  if (status === "recalled") return "ready"
  const i = KOT_FLOW.indexOf(status as (typeof KOT_FLOW)[number])
  if (i < 0 || i >= KOT_FLOW.length - 1) return null
  return KOT_FLOW[i + 1]
}

/**
 * The board's query shape. Shared by the server page and the client's Realtime
 * refetch — if the two diverge, the first ping visibly strips the tickets (the
 * same reason lib/pos-constants.ts exists). order_items.id is what a void acts
 * on; notes + modifiers give the cook the sub-lines the printed KOT has.
 */
export const KDS_SELECT =
  "id, status, created_at, printed_at, station_id, order_id, " +
  "kitchen_stations(name), " +
  "orders(status, table_id, restaurant_tables!orders_table_id_fkey(label)), " +
  "kot_items(id, qty, status, " +
  "order_items(id, name_snapshot, is_void, void_reason, notes, " +
  "order_item_modifiers(name_snapshot, qty)))"

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
