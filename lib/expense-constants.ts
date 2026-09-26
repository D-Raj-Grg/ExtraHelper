/**
 * Shared by the Expenses page (server), its client forms and the day-close
 * sheet. A plain module so both sides of the RSC boundary can import it.
 */

export const PAID_FROM = ["cash", "online", "owner"] as const
export type PaidFrom = (typeof PAID_FROM)[number]

export const PAID_FROM_LABELS: Record<PaidFrom, string> = {
  cash: "Cash",
  online: "Online / eSewa",
  owner: "Owner's pocket",
}

/** One line under each choice — the difference matters for the night count. */
export const PAID_FROM_HINTS: Record<PaidFrom, string> = {
  cash: "Taken from today's cash",
  online: "Paid by QR, wallet or bank",
  owner: "Outside money, not from sales",
}

export function paidFromLabel(v: string): string {
  return PAID_FROM_LABELS[v as PaidFrom] ?? v
}

export type ExpenseCategory = { id: string; name: string; archived: boolean }

export type ExpenseRow = {
  id: string
  category_id: string
  category: string
  amount_cents: number
  note: string
  paid_from: PaidFrom
  created_at: string
  created_by: string
  by: string | null
  voided: boolean
  void_reason: string | null
  /** The caller may edit / void this row (manager, or their own entry today). */
  editable: boolean
  /** Short-lived signed URL; the bucket is private. */
  receipt_url: string | null
  /** The caller may attach, replace or remove the photo (logger or manager). */
  can_attach: boolean
}

/** How long a receipt link stays valid once the page renders. */
export const RECEIPT_URL_TTL_SECONDS = 60 * 60

export const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif"
