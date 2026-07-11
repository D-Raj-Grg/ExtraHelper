"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"

export type PosState = { error: string } | { ok: true } | undefined

const ORDER_ROLES = ["owner", "manager", "cashier", "waiter"] as const

/** Start a draft order (optionally against a table) and open its builder. */
export async function startOrder(formData: FormData): Promise<void> {
  const tenant = await requireRole(...ORDER_ROLES)
  const tableId = String(formData.get("tableId") ?? "").trim() || null
  const orderType = tableId ? "dine_in" : "pickup"

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("orders")
    .insert({
      tenant_id: tenant.tenantId,
      table_id: tableId,
      order_type: orderType,
      status: "draft",
    })
    .select("id")
    .single()
  if (error || !data) redirect("/pos")

  if (tableId) {
    await supabase.from("restaurant_tables").update({ state: "occupied" }).eq("id", tableId)
  }
  redirect(`/pos/${data.id}`)
}

/** Add a menu item to a draft order (snapshots name + price). */
export async function addItem(orderId: string, itemId: string): Promise<PosState> {
  const tenant = await requireRole(...ORDER_ROLES)
  const supabase = await createClient()

  const { data: item, error: itemErr } = await supabase
    .from("menu_items")
    .select("name, base_price_cents, is_86")
    .eq("id", itemId)
    .single()
  if (itemErr || !item) return { error: "Item not found." }
  if (item.is_86) return { error: `${item.name} is 86'd (out of stock).` }

  const { error } = await supabase.from("order_items").insert({
    tenant_id: tenant.tenantId,
    order_id: orderId,
    item_id: itemId,
    name_snapshot: item.name,
    qty: 1,
    unit_price_cents: item.base_price_cents,
    status: "draft",
  })
  if (error) return { error: error.message }

  revalidatePath(`/pos/${orderId}`)
  return { ok: true }
}

export async function removeItem(orderId: string, orderItemId: string): Promise<PosState> {
  await requireRole(...ORDER_ROLES)
  const supabase = await createClient()
  const { error } = await supabase.from("order_items").delete().eq("id", orderItemId)
  if (error) return { error: error.message }
  revalidatePath(`/pos/${orderId}`)
  return { ok: true }
}

/** Fire the order to the kitchen — splits into per-station KOTs (trusted fn). */
export async function fireOrder(orderId: string): Promise<PosState> {
  await requireRole(...ORDER_ROLES)
  const supabase = await createClient()
  const { error } = await supabase.rpc("fire_order", { _order_id: orderId })
  if (error) return { error: error.message }
  revalidatePath(`/pos/${orderId}`)
  return { ok: true }
}
