import type { createClient } from "@/lib/supabase/server"

/** The server Supabase client, typed off the factory instead of `any`. */
export type ReportClient = Awaited<ReturnType<typeof createClient>>

export type ReportCtx = {
  supabase: ReportClient
  tenantId: string
  /** ISO range bounds — `to` is exclusive. */
  F: string
  T: string
  cur: string
}

export type Sales = {
  revenue_cents: number
  orders: number
  tax_cents: number
  service_cents: number
  discount_cents: number
  /**
   * Gross profit on net item sales after refunds — Σ(subtotal − discount) on
   * paid bills, minus refunds, minus the cost snapshot on each sold line. Tax,
   * service and tips are excluded. All six are null when the caller lacks
   * `profit.view`.
   */
  net_sales_cents: number | null
  refunds_cents: number | null
  cogs_cents: number | null
  gross_profit_cents: number | null
  /** One decimal place, already ×100 (e.g. 62.5). */
  margin_pct: number | null
  /** Sold lines with no cost snapshot; the profit figures above exclude them. */
  uncosted_lines: number | null
}

/** One row of `report_top_items`. */
export type TopItem = {
  description: string
  qty: number
  revenue_cents: number
  /**
   * null/absent when the caller lacks profit.view, or when any line of this
   * item in the range had no cost snapshot.
   */
  cost_cents: number | null
  profit_cents: number | null
}

export type Breakdown = { label: string; orders: number; revenue_cents: number }

/**
 * One business day in a range — the spine the other cuts hang off.
 * `day_label` is rendered server-side on purpose: `new Date("2026-08-20")`
 * parses as UTC midnight and shifts the date backwards west of Greenwich.
 */
export type DayRow = {
  day: string
  day_label: string
  orders: number
  revenue_cents: number
  avg_cents: number
}
