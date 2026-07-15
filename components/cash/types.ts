export type OpenSession = {
  id: string
  opening_float_cents: number
  opened_at: string
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
}
