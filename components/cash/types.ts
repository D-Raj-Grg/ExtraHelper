export type OpenSession = {
  id: string
  opening_float_cents: number
  opened_at: string
}

export type CashMovement = {
  id: string
  kind: "payout" | "paid_in"
  category: "supplier" | "supplies" | "utilities" | "staff_advance" | "transport" | "other"
  amount_cents: number
  note: string
  status: "pending" | "approved" | "rejected"
  /** True when the close resolved it instead of a manager. Flagged in reports. */
  auto_approved: boolean
  created_at: string
  /** Display name of whoever recorded it; null if unknown. */
  recorded_by: string | null
}

/**
 * Enum values never reach staff, so the labels live here rather than in a
 * `.replace("_", " ")` at the render site.
 */
export const MOVEMENT_CATEGORY_LABELS: Record<CashMovement["category"], string> = {
  supplier: "Supplier",
  supplies: "Supplies",
  utilities: "Utilities",
  staff_advance: "Staff advance",
  transport: "Transport",
  other: "Other",
}

export type ClosedSession = {
  id: string
  opening_float_cents: number
  expected_cents: number | null
  counted_cents: number | null
  variance_cents: number | null
  opened_at: string
  closed_at: string | null
  /** Display name of the cashier who ran the shift; null if unknown. */
  cashier: string | null
  /** Approved cash out of the drawer during the shift. */
  payouts_cents: number
  /** Approved cash added to the drawer from outside a sale. */
  paid_in_cents: number
  /**
   * How many movements the close approved on the cashier's behalf. This is the
   * compensating control for auto-approve-at-close: nothing blocks a shift from
   * ending, but an owner can see which entries no manager ever reviewed.
   */
  auto_approved_count: number
}
