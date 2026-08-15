/**
 * Shared purchasing constants.
 *
 * A plain module, not `app/(app)/purchasing/actions.ts`: a "use server" file may
 * only export async functions, and that file also pulls in lib/supabase/server,
 * which drags next/headers into any client bundle that imports from it.
 */

/** Methods a supplier can be paid by, in the order staff pick them. */
export const SUPPLIER_METHODS = [
  "cash",
  "bank",
  "esewa",
  "fonepay",
  "card",
  "wallet",
  "other",
] as const

export type SupplierMethod = (typeof SUPPLIER_METHODS)[number]

export const SUPPLIER_METHOD_LABELS: Record<SupplierMethod, string> = {
  cash: "Cash (from the drawer)",
  bank: "Bank transfer",
  esewa: "eSewa",
  fonepay: "FonePay",
  card: "Card",
  wallet: "Wallet",
  other: "Other / outside cash",
}
