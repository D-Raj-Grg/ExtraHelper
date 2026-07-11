"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"

export type InvState = { error: string } | { ok: true } | undefined

const INV_ROLES = ["owner", "manager", "inventory"] as const

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
  const tenant = await requireRole(...INV_ROLES)
  if (!Number.isFinite(deltaQty) || deltaQty === 0)
    return { error: "Enter a non-zero quantity." }

  const supabase = await createClient()
  const { data: item, error: readErr } = await supabase
    .from("inventory_items")
    .select("current_qty")
    .eq("id", itemId)
    .single()
  if (readErr || !item) return { error: "Item not found." }

  const { error: updErr } = await supabase
    .from("inventory_items")
    .update({ current_qty: Number(item.current_qty) + deltaQty })
    .eq("id", itemId)
  if (updErr) return { error: updErr.message }

  await supabase.from("stock_movements").insert({
    tenant_id: tenant.tenantId,
    inventory_item_id: itemId,
    type,
    qty: deltaQty,
    reference: reason || null,
  })

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
