/**
 * The `daily_report` payload — one business day's close.
 *
 * A plain module with no server imports, so the day-close sheet (server), the
 * print renderer and any client control can all share one shape. Mirrors the
 * jsonb built in `supabase/migrations/20260821091000_daily_report.sql`.
 */

export type DayPaymentRow = { method: string; amount_cents: number; count: number }

export type DayCashSession = {
  id: string
  cashier: string | null
  opening_float_cents: number
  expected_cents: number | null
  counted_cents: number | null
  variance_cents: number | null
  payouts_cents: number
  paid_in_cents: number
  auto_approved_count: number
  opened_at: string
  closed_at: string | null
}

export type DayReport = {
  day: string
  day_label: string
  from: string
  to: string
  currency: string
  timezone: string
  cutoff_minutes: number
  sales: {
    revenue_cents: number
    subtotal_cents: number
    tax_cents: number
    service_cents: number
    discount_cents: number
    tip_cents: number
    rounding_cents: number
    bills: number
    tables_served: number
    avg_cents: number
  }
  payments: DayPaymentRow[]
  payments_total_cents: number
  /**
   * Payments taken minus revenue raised. Positive ⇒ money collected today
   * against bills raised on an earlier day; negative ⇒ bills raised today that
   * nobody has settled yet. The two legitimately disagree because revenue
   * buckets on `bills.created_at` and payments on `payments.created_at`, so the
   * sheet states the gap rather than hiding it.
   */
  carried_cents: number
  refunds: { total_cents: number; cash_cents: number; count: number }
  voids: { count: number; lines: number; value_cents: number }
  cancellations: { count: number; value_cents: number }
  void_bills: number
  cash: {
    open_count: number
    sessions: DayCashSession[]
    totals: {
      float_cents: number
      payouts_cents: number
      paid_in_cents: number
      expected_cents: number
      counted_cents: number
      variance_cents: number
      sessions: number
    }
  }
  top_items: { description: string; qty: number; revenue_cents: number }[]
}

/** "4:00 am" for 240; null at midnight, where there is nothing to explain. */
export function cutoffLabel(minutes: number): string | null {
  if (!minutes) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const suffix = h < 12 ? "am" : "pm"
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`
}

/** The previous / next calendar day as "YYYY-MM-DD", with no timezone math. */
export function shiftDay(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}
