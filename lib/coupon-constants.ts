/**
 * Shared by the Coupons page (server), its client form and list, the checkout
 * panel and the guest surfaces. A plain module so both sides of the RSC
 * boundary can import it.
 */

import { money } from "@/lib/format"
import { orderTypeLabel, type OrderType } from "@/lib/order-constants"

export type CouponType = "percent" | "flat"

/** One row of `list_coupons`. */
export type CouponRow = {
  id: string
  code: string
  name: string | null
  type: CouponType
  value: number
  is_active: boolean
  valid_from: string | null
  valid_to: string | null
  usage_limit: number | null
  used_count: number
  min_subtotal_cents: number
  once_per_customer: boolean
  order_types: OrderType[] | null
  created_at: string
  redemptions: number
  discount_given_cents: number
  last_redeemed_at: string | null
}

/** What `public_coupon_preview` returns when the code passes. */
export type CouponPreview = {
  code: string
  name: string | null
  type: CouponType
  value: number
  discount_cents: number
  min_subtotal_cents: number
}

export const COUPON_CODE_RE = /^[A-Z0-9-]{4,24}$/

/**
 * What a coupon rule can be limited to. A QR-table order is dine-in as far as
 * a rule is concerned (the server folds `qr` into `dine_in` when checking), so
 * the form never offers it separately.
 */
export const COUPON_ORDER_TYPES = ["dine_in", "pickup", "delivery"] as const satisfies readonly OrderType[]

/**
 * The code inside whatever was scanned or pasted: a flyer URL carrying
 * `?coupon=`, or the bare code. Uppercased and trimmed; null when it doesn't
 * look like one. Parsing only — the server decides whether it is valid.
 */
export function extractCouponCode(raw: string | string[] | null | undefined): string | null {
  // A repeated query key (`?coupon=a&coupon=b`) arrives as an array; the first one wins.
  const first = Array.isArray(raw) ? raw[0] : raw
  const text = (first ?? "").trim()
  if (!text) return null
  let candidate = text
  if (/^https?:\/\//i.test(text)) {
    try {
      candidate = new URL(text).searchParams.get("coupon") ?? ""
    } catch {
      candidate = ""
    }
  }
  const code = candidate.trim().toUpperCase()
  return COUPON_CODE_RE.test(code) ? code : null
}

/** The URL a flyer QR encodes: the storefront with the code pre-filled. */
export function couponUrl(origin: string, slug: string, code: string): string {
  return `${origin}/s/${encodeURIComponent(slug)}?coupon=${encodeURIComponent(code)}`
}

/** "10% off" / "NPR 200 off" — what the coupon is worth, in words. */
export function couponValueLabel(type: CouponType, value: number, currency: string): string {
  return type === "percent" ? `${trimZeros(value)}% off` : `${money(Math.round(value * 100), currency)} off`
}

function trimZeros(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(/\.?0+$/, "")
}

/** "10% off · min NPR 1,000 · dine-in only" — the rules on one line. */
export function couponSummary(
  c: Pick<CouponRow, "type" | "value" | "min_subtotal_cents" | "order_types" | "once_per_customer">,
  currency: string,
): string {
  const parts = [couponValueLabel(c.type, c.value, currency)]
  if (c.min_subtotal_cents > 0) parts.push(`min ${money(c.min_subtotal_cents, currency)}`)
  if (c.order_types && c.order_types.length > 0 && c.order_types.length < COUPON_ORDER_TYPES.length) {
    parts.push(c.order_types.map((t) => orderTypeLabel(t).toLowerCase()).join(" / ") + " only")
  }
  if (c.once_per_customer) parts.push("once per customer")
  return parts.join(" · ")
}

export type CouponStatus = "active" | "paused" | "scheduled" | "expired" | "used_up"

/** Where a campaign stands right now — the badge on the list. */
export function couponStatus(
  c: Pick<CouponRow, "is_active" | "valid_from" | "valid_to" | "usage_limit" | "used_count">,
  now: number,
): CouponStatus {
  if (!c.is_active) return "paused"
  if (c.usage_limit !== null && c.used_count >= c.usage_limit) return "used_up"
  if (c.valid_to && new Date(c.valid_to).getTime() <= now) return "expired"
  if (c.valid_from && new Date(c.valid_from).getTime() > now) return "scheduled"
  return "active"
}

export const COUPON_STATUS_LABEL: Record<CouponStatus, string> = {
  active: "Active",
  paused: "Paused",
  scheduled: "Scheduled",
  expired: "Expired",
  used_up: "Used up",
}
