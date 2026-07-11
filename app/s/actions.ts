"use server"

import { createClient } from "@/lib/supabase/server"

export type StoreState =
  | { error: string }
  | { ok: true; orderId: string }
  | undefined

export async function placeOnlineOrder(
  slug: string,
  items: { item_id: string; qty: number }[],
  fulfillment: "delivery" | "pickup",
  contact: { name: string; phone: string; address?: string },
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
  })
  if (error || !data) return { error: error?.message ?? "Could not place order." }
  return { ok: true, orderId: data as string }
}
