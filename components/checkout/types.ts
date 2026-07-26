/**
 * Shared shapes for the checkout screen.
 *
 * A plain module (no server imports) so every client pane can read it — see the
 * client-component/`lib/supabase/server` trap in CLAUDE.md.
 */

export type CheckoutBill = {
  id: string
  status: string
  created_at: string
  subtotal_cents: number
  tax_cents: number
  service_charge_cents: number
  discount_cents: number
  tip_cents: number
  rounding_cents: number
  total_cents: number
  note: string | null
  restaurant_tables: { label: string } | null
}

/** One billed line, plus the modifiers that were priced into it. */
export type CheckoutItem = {
  id: string
  order_item_id: string | null
  description: string
  qty: number
  unit_price_cents: number
  total_cents: number
  /** Per-line discount already applied (cents), for the inline Discount cell. */
  discount_cents: number
  modifiers: { id: string; name: string; price_cents: number; qty: number }[]
}

export type CheckoutPayment = { id: string; method: string; amount_cents: number }

export type CheckoutCharge = { id: string; label: string; amount_cents: number }

export type CheckoutCustomer = {
  id: string
  name: string | null
  phone: string | null
  points: number
}

export type MergeableOrder = {
  id: string
  order_type: string
  status: string
  restaurant_tables: { label: string } | null
}

/** Everything the printed/preview invoice needs that isn't on the bill itself. */
export type InvoiceMeta = {
  tenantName: string
  timezone: string
  billedBy: string
  /** Order start → now, in minutes; null when there's no order behind the bill. */
  serviceMinutes: number | null
  waiterName: string | null
  header?: string
  footer?: string
  terms?: string
}

/** How the cashier intends to settle. */
export type PayMode = "paid" | "credit" | "partial"

/** In what form the money arrives. 'online' charges the gateway first. */
export type PayMethod = "cash" | "card" | "online"
