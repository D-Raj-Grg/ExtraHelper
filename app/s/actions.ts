"use server"

import { createClient } from "@/lib/supabase/server"
import { extractCouponCode, type CouponPreview } from "@/lib/coupon-constants"

export type StoreState =
  | { error: string }
  | { ok: true; orderId: string }
  | undefined

export async function placeOnlineOrder(
  slug: string,
  items: { item_id: string; qty: number }[],
  fulfillment: "delivery" | "pickup",
  contact: { name: string; phone: string; address?: string },
  coupon?: string | null,
): Promise<StoreState> {
  if (!items.length) return { error: "Add at least one item." }
  if (!contact.name.trim()) return { error: "Name is required." }
  if (fulfillment === "delivery" && !contact.address?.trim())
    return { error: "Delivery address is required." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("place_online_order", {
    _slug: slug,
    _items: items,
    _fulfillment: fulfillment,
    _name: contact.name,
    _phone: contact.phone,
    _address: contact.address ? { line: contact.address } : null,
    ...(coupon ? { _coupon: coupon } : {}),
  })
  if (error || !data) return { error: error?.message ?? "Could not place order." }
  return { ok: true, orderId: data as string }
}

/** Storefront: check a coupon against the cart before ordering. */
export async function previewCoupon(
  slug: string,
  code: string,
  subtotalCents: number,
  fulfillment: "delivery" | "pickup",
): Promise<CouponPreview | { error: string }> {
  const normalised = extractCouponCode(code)
  if (!normalised) return { error: "That coupon code isn't valid" }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("public_coupon_preview", {
    _slug: slug,
    _token: null as unknown as string,
    _code: normalised,
    _subtotal_cents: subtotalCents,
    _order_type: fulfillment,
  })
  if (error || !data) return { error: error?.message ?? "Could not check that coupon." }
  return data as unknown as CouponPreview | { error: string }
}
