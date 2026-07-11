"use server"

import { createClient } from "@/lib/supabase/server"

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
  items: { item_id: string; qty: number }[],
): Promise<QrState> {
  if (!items.length) return { error: "Add at least one item." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("place_qr_order", {
    _token: token,
    _items: items,
  })
  if (error || !data) return { error: error?.message ?? "Could not place order." }
  return { ok: true, orderId: data as string }
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

