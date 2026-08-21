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
