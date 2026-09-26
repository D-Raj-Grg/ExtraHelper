/**
 * Order-lifecycle notifications (`public.notifications`, written only by the
 * triggers in `20260926120000_order_notifications.sql`): shape, labels, tones
 * and the unread rule, shared by the header bell and the /notifications feed.
 *
 * Plain module on purpose — the /notifications Server Component and the client
 * bell both import it (see the client-reference trap in CLAUDE.md). Icons live
 * with the row component in `components/notification-row.tsx`.
 */

export type NotificationKind =
  | "order_new"
  | "order_preparing"
  | "order_ready"
  | "order_served"
  | "order_billed"
  | "order_cancelled"
  | "bill_paid"

export type AppNotification = {
  id: string
  kind: string
  order_id: string | null
  bill_id: string | null
  order_type: string | null
  table_label: string | null
  amount_cents: number | null
  title: string
  body: string
  actor_id: string | null
  created_at: string
}

export const NOTIFICATION_SELECT =
  "id, kind, order_id, bill_id, order_type, table_label, amount_cents, title, body, actor_id, created_at"

/** Rows in the bell's panel. */
export const BELL_LIMIT = 20
/** Rows in the /notifications Updates feed. */
export const FEED_LIMIT = 100

/**
 * Someone with no read cursor yet (never pressed "Mark all read") counts only
 * the last day as unread — otherwise their first login shows a badge of every
 * order the restaurant has ever taken.
 */
export const UNREAD_FALLBACK_MS = 24 * 60 * 60 * 1000

const KIND_LABEL: Record<NotificationKind, string> = {
  order_new: "New order",
  order_preparing: "Preparing",
  order_ready: "Ready to serve",
  order_served: "Served",
  order_billed: "Billed",
  order_cancelled: "Cancelled",
  bill_paid: "Paid",
}

export function notificationKindLabel(kind: string): string {
  return KIND_LABEL[kind as NotificationKind] ?? kind.replace(/_/g, " ")
}

/**
 * One tone per step, matching the app-wide semantic colours (and
 * `ORDER_STATUS_STYLE`): blue = info/new, amber = in progress, emerald = good,
 * orange = bill, destructive = cancelled. Always paired with a per-kind icon
 * and the title — the colour never carries the meaning alone.
 */
export const NOTIFICATION_KIND_TONE: Record<NotificationKind, string> = {
  order_new: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  order_preparing: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  order_ready: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  order_served: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  order_billed: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  order_cancelled: "bg-destructive/10 text-destructive",
  bill_paid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
}

export function notificationTone(kind: string): string {
  return NOTIFICATION_KIND_TONE[kind as NotificationKind] ?? "bg-muted text-muted-foreground"
}

/**
 * Unread = newer than the user's read cursor and not caused by them. Your own
 * taps never count: whoever marked the order ready already knows it is ready.
 */
export function isUnread(n: AppNotification, cursor: string | null, userId: string): boolean {
  if (cursor === null) return false
  if (n.actor_id !== null && n.actor_id === userId) return false
  return Date.parse(n.created_at) > Date.parse(cursor)
}

/**
 * Where a notification leads, if the viewer can open it: the order screen for
 * order events, the bill for a payment. Null when neither page is theirs —
 * a row that links to a redirect is worse than a row that doesn't link.
 */
export function notificationHref(n: AppNotification, perms: Set<string>): string | null {
  if (n.order_id && perms.has("order.view")) return `/pos/${n.order_id}`
  if (n.bill_id && perms.has("checkout.view")) return `/bill/${n.bill_id}`
  return null
}
