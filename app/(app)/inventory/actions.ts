"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"

export type InvState = { error: string } | { ok: true } | undefined

const INV_ROLES = ["owner", "manager", "inventory"] as const

/** Open a new stock count (snapshots on-hand as theoretical) and go edit it. */
export async function startCount(): Promise<void> {
  const tenant = await requireRole(...INV_ROLES)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("start_stock_count", { _tenant: tenant.tenantId })
  if (error || !data) redirect("/inventory")
  redirect(`/inventory/count/${data}`)
}

/** Record the counted (actual) quantity for a line. */
export async function setCountActual(
  countItemId: string,
  countId: string,
  actual: number,
): Promise<InvState> {
  const tenant = await requireRole(...INV_ROLES)
  if (!Number.isFinite(actual) || actual < 0) return { error: "Enter a valid quantity." }
  const supabase = await createClient()
  const { error } = await supabase
    .from("stock_count_items")
    .update({ actual_qty: actual })
    .eq("id", countItemId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath(`/inventory/count/${countId}`)
  return { ok: true }
}

/** Post the count — reconcile on-hand to actual + log 'count' movements. */
export async function postCount(countId: string): Promise<InvState> {
  await requireRole(...INV_ROLES)
  const supabase = await createClient()
  const { error } = await supabase.rpc("post_stock_count", { _count_id: countId })
  if (error) return { error: error.message }
  revalidatePath(`/inventory/count/${countId}`)
  revalidatePath("/inventory")
  return { ok: true }
}

export async function createInventoryItem(
  _prev: InvState,
  formData: FormData,
): Promise<InvState> {
  const tenant = await requireRole(...INV_ROLES)
  const name = String(formData.get("name") ?? "").trim()
  const uom = String(formData.get("uom") ?? "unit").trim() || "unit"
  const reorder = Number(formData.get("reorder") ?? 0)
  const cost = Math.round(Number(formData.get("cost") ?? 0) * 100)
  const qty = Number(formData.get("qty") ?? 0)

  if (!name) return { error: "Item name is required." }
  if (Number.isNaN(reorder) || reorder < 0) return { error: "Invalid reorder level." }
  if (Number.isNaN(qty) || qty < 0) return { error: "Invalid quantity." }

  const supabase = await createClient()
  const { error } = await supabase.from("inventory_items").insert({
    tenant_id: tenant.tenantId,
    name,
    uom,
    reorder_level: reorder,
    current_qty: qty,
    cost_cents: Number.isNaN(cost) ? 0 : cost,
  })
  if (error) return { error: error.message }

  revalidatePath("/inventory")
  return { ok: true }
}

/** Manual stock movement (purchase-in, wastage, adjustment) + qty update. */
export async function adjustStock(
  itemId: string,
  deltaQty: number,
  type: "purchase" | "wastage" | "adjustment",
  reason: string,
): Promise<InvState> {
  await requireRole(...INV_ROLES)
  if (!Number.isFinite(deltaQty) || deltaQty === 0)
    return { error: "Enter a non-zero quantity." }

  const supabase = await createClient()
  // Atomic: current_qty = current_qty + delta (+ movement log) in one statement,
  // so concurrent adjusts can't clobber each other. RLS + role enforced inside.
  const { error } = await supabase.rpc("adjust_inventory", {
    _item: itemId,
    _delta: deltaQty,
    _type: type,
    _reason: reason || "",
  })
  if (error) return { error: error.message }

  revalidatePath("/inventory")
  return { ok: true }
}

/** Map a menu item → ingredient qty (recipe / BOM). */
export async function addRecipe(
  _prev: InvState,
  formData: FormData,
): Promise<InvState> {
  const tenant = await requireRole(...INV_ROLES)
  const menuItemId = String(formData.get("menuItemId") ?? "").trim()
  const inventoryItemId = String(formData.get("inventoryItemId") ?? "").trim()
  const qty = Number(formData.get("qty") ?? 0)

  if (!menuItemId || !inventoryItemId) return { error: "Pick a dish and an ingredient." }
  if (Number.isNaN(qty) || qty <= 0) return { error: "Quantity must be positive." }

  const supabase = await createClient()
  const { error } = await supabase.from("recipes").insert({
    tenant_id: tenant.tenantId,
    menu_item_id: menuItemId,
    inventory_item_id: inventoryItemId,
    qty,
  })
  if (error) return { error: error.message }

  revalidatePath("/inventory")
  return { ok: true }
}
