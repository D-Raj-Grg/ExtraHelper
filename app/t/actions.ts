"use server"

import { createClient } from "@/lib/supabase/server"
import { extractCouponCode, type CouponPreview } from "@/lib/coupon-constants"

export type QrState =
  | { error: string }
  | { ok: true; orderId: string }
  | undefined

/**
 * Place a QR dine-in order (public / no auth). Runs as the anon role and calls
 * the SECURITY DEFINER `place_qr_order`, which validates the token and only
 * touches the tenant it resolves to.
 */
export async function placeQrOrder(
  token: string,
  items: { item_id: string; variant_id?: string | null; qty: number }[],
  coupon?: string | null,
): Promise<QrState> {
  if (!items.length) return { error: "Add at least one item." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("place_qr_order", {
    _token: token,
    _items: items,
    ...(coupon ? { _coupon: coupon } : {}),
  })
  if (error || !data) return { error: error?.message ?? "Could not place order." }
  return { ok: true, orderId: data as string }
}

/**
 * QR: check a coupon against the cart before ordering, so the guest sees the
 * deal. The server answers `{error}` for a code it won't take — a wrong code is
 * an answer, not a fault.
 */
export async function previewCoupon(
  token: string,
  code: string,
  subtotalCents: number,
): Promise<CouponPreview | { error: string }> {
  const normalised = extractCouponCode(code)
  if (!normalised) return { error: "That coupon code isn't valid" }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("public_coupon_preview", {
    _slug: null as unknown as string,
    _token: token,
    _code: normalised,
    _subtotal_cents: subtotalCents,
    _order_type: "qr",
  })
  if (error || !data) return { error: error?.message ?? "Could not check that coupon." }
  return data as unknown as CouponPreview | { error: string }
}

/** QR: request the bill (flags the table for staff). */
export async function requestBill(token: string): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("qr_request_bill", { _token: token })
  return { ok: data === true }
}

/** QR: post-visit feedback. */
export async function submitFeedback(
  token: string,
  rating: number,
  comment: string,
): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("submit_feedback", {
    _token: token,
    _rating: rating,
    _comment: comment,
  })
  return { ok: data === true }
}

