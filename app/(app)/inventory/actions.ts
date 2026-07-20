"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"

export type InvState = { error: string } | { ok: true } | undefined

const INV_ROLES = ["owner", "manager", "inventory"] as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const category = String(formData.get("category") ?? "").trim() || null
  const reorder = Number(formData.get("reorder") ?? 0)
  const parRaw = String(formData.get("par") ?? "").trim()
  const par = parRaw === "" ? null : Number(parRaw)
  const cost = Math.round(Number(formData.get("cost") ?? 0) * 100)
  const qty = Number(formData.get("qty") ?? 0)

  if (!name) return { error: "Item name is required." }
  if (Number.isNaN(reorder) || reorder < 0) return { error: "Invalid reorder level." }
  if (par !== null && (Number.isNaN(par) || par < 0)) return { error: "Invalid par level." }
  if (Number.isNaN(qty) || qty < 0) return { error: "Invalid quantity." }

  const supabase = await createClient()
  const { error } = await supabase.from("inventory_items").insert({
    tenant_id: tenant.tenantId,
    name,
    uom,
    category,
    reorder_level: reorder,
    // par_level is NOT NULL (0 = "no par target"; the reorder RPC treats 0 as
    // unset via nullif). A blank Par field must store 0, not null.
    par_level: par ?? 0,
    current_qty: qty,
    cost_cents: Number.isNaN(cost) ? 0 : cost,
  })
  if (error) return { error: error.message }

  revalidatePath("/inventory")
  return { ok: true }
}

/** Edit an inventory item's fields (category / par / reorder / uom / cost). */
export async function updateInventoryItem(
  itemId: string,
  fields: {
    name?: string
    category?: string | null
    uom?: string
    reorder?: number
    par?: number | null
    cost?: number
    supplierId?: string | null
  },
): Promise<InvState> {
  const tenant = await requireRole(...INV_ROLES)
  const patch: Record<string, unknown> = {}
  if (fields.name !== undefined) {
    const n = fields.name.trim()
    if (!n) return { error: "Item name is required." }
    patch.name = n
  }
  if (fields.category !== undefined) patch.category = fields.category?.trim() || null
  if (fields.uom !== undefined) patch.uom = fields.uom.trim() || "unit"
  if (fields.supplierId !== undefined) {
    if (fields.supplierId !== null && !UUID_RE.test(fields.supplierId)) return { error: "Invalid supplier." }
    patch.supplier_id = fields.supplierId
  }
  if (fields.reorder !== undefined) {
    if (!Number.isFinite(fields.reorder) || fields.reorder < 0) return { error: "Invalid reorder level." }
    patch.reorder_level = fields.reorder
  }
  if (fields.par !== undefined) {
    if (fields.par !== null && (!Number.isFinite(fields.par) || fields.par < 0))
      return { error: "Invalid par level." }
    // par_level is NOT NULL — a cleared Par stores 0 ("no par"), never null.
    patch.par_level = fields.par ?? 0
  }
  if (fields.cost !== undefined) patch.cost_cents = Math.max(0, Math.round(fields.cost))
  if (Object.keys(patch).length === 0) return { ok: true }

  const supabase = await createClient()
  const { error } = await supabase
    .from("inventory_items")
    .update(patch)
    .eq("id", itemId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/inventory")
  return { ok: true }
}

/** Manual stock movement (purchase-in, wastage, adjustment) + qty update. */
export async function adjustStock(
  itemId: string,
  deltaQty: number,
  type: "purchase" | "wastage" | "adjustment" | "staff_meal" | "transfer",
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

/** One line of a dish's recipe: an ingredient and how much of it the dish uses. */
export type RecipeLine = { inventoryItemId: string; qty: number }

/**
 * Save a dish's WHOLE recipe in one call — the editor sends every line for the
 * dish, and this reconciles: lines dropped from the editor are deleted, the rest
 * are upserted. Replaces the old one-ingredient-per-submit `addRecipe`.
 *
 * Selling this dish then auto-deducts these ingredients on kitchen fire
 * (trg_deduct_stock), so on-hand stays accurate without manual entry.
 */
export async function setDishRecipe(
  menuItemId: string,
  lines: RecipeLine[],
): Promise<InvState> {
  const tenant = await requireRole(...INV_ROLES)
  if (!UUID_RE.test(menuItemId)) return { error: "Pick a dish." }

  // Dedupe by ingredient (last wins) and validate. A blank ingredient row is
  // dropped silently so a half-filled add-row doesn't block the save. Ids are
  // UUID-checked before they reach the delete filter below — a malformed id
  // there could corrupt the `not in (...)` list and wipe the recipe.
  const byIngredient = new Map<string, number>()
  for (const line of lines) {
    const id = line.inventoryItemId?.trim()
    if (!id) continue
    if (!UUID_RE.test(id)) return { error: "That ingredient looks wrong — pick it from the list." }
    const qty = Number(line.qty)
    if (!Number.isFinite(qty) || qty <= 0) return { error: "Every ingredient needs a quantity above zero." }
    byIngredient.set(id, qty)
  }
  const kept = [...byIngredient.keys()]

  const supabase = await createClient()

  // Verify the dish is ours before writing anything under it.
  const { data: dish } = await supabase
    .from("menu_items")
    .select("id")
    .eq("id", menuItemId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  if (!dish) return { error: "Dish not found." }

  // Remove lines the editor no longer has. `not in ()` is invalid SQL, so when
  // the recipe is cleared entirely we delete unconditionally for the dish.
  let del = supabase
    .from("recipes")
    .delete()
    .eq("tenant_id", tenant.tenantId)
    .eq("menu_item_id", menuItemId)
  if (kept.length) del = del.not("inventory_item_id", "in", `(${kept.join(",")})`)
  const { error: delErr } = await del
  if (delErr) return { error: delErr.message }

  if (kept.length) {
    const { error: upErr } = await supabase.from("recipes").upsert(
      kept.map((inventoryItemId) => ({
        tenant_id: tenant.tenantId,
        menu_item_id: menuItemId,
        inventory_item_id: inventoryItemId,
        qty: byIngredient.get(inventoryItemId)!,
      })),
      { onConflict: "menu_item_id,inventory_item_id" },
    )
    if (upErr) return { error: upErr.message }
  }

  revalidatePath("/inventory")
  return { ok: true }
}

/**
 * Set a variant's recipe scale — how much of the base recipe a portion uses
 * (Half = 0.5, Large = 1.5). The deduct trigger multiplies the dish's recipe by
 * this when that variant is sold. 1 = same as the base recipe.
 */
export async function updateVariantScale(variantId: string, scale: number): Promise<InvState> {
  const tenant = await requireRole(...INV_ROLES)
  if (!Number.isFinite(scale) || scale < 0) return { error: "Scale must be zero or more." }
  const supabase = await createClient()
  const { error } = await supabase
    .from("item_variants")
    .update({ recipe_scale: scale })
    .eq("id", variantId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/inventory")
  return { ok: true }
}

/** Remove one recipe line by id. */
export async function deleteRecipeLine(recipeId: string): Promise<InvState> {
  const tenant = await requireRole(...INV_ROLES)
  const supabase = await createClient()
  const { error } = await supabase
    .from("recipes")
    .delete()
    .eq("id", recipeId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/inventory")
  return { ok: true }
}

/**
 * Save an add-on's (modifier's) whole ingredient list in one call — same
 * reconcile shape as setDishRecipe. Selling the dish WITH this modifier deducts
 * these on top of the dish recipe (trg_deduct_stock reads order_item_modifiers).
 */
export async function setModifierRecipe(
  modifierId: string,
  lines: RecipeLine[],
): Promise<InvState> {
  const tenant = await requireRole(...INV_ROLES)
  if (!UUID_RE.test(modifierId)) return { error: "Pick an add-on." }

  const byIngredient = new Map<string, number>()
  for (const line of lines) {
    const id = line.inventoryItemId?.trim()
    if (!id) continue
    if (!UUID_RE.test(id)) return { error: "That ingredient looks wrong — pick it from the list." }
    const qty = Number(line.qty)
    if (!Number.isFinite(qty) || qty <= 0) return { error: "Every ingredient needs a quantity above zero." }
    byIngredient.set(id, qty)
  }
  const kept = [...byIngredient.keys()]

  const supabase = await createClient()
  const { data: mod } = await supabase
    .from("modifiers")
    .select("id")
    .eq("id", modifierId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  if (!mod) return { error: "Add-on not found." }

  let del = supabase
    .from("modifier_ingredients")
    .delete()
    .eq("tenant_id", tenant.tenantId)
    .eq("modifier_id", modifierId)
  if (kept.length) del = del.not("inventory_item_id", "in", `(${kept.join(",")})`)
  const { error: delErr } = await del
  if (delErr) return { error: delErr.message }

  if (kept.length) {
    const { error: upErr } = await supabase.from("modifier_ingredients").upsert(
      kept.map((inventoryItemId) => ({
        tenant_id: tenant.tenantId,
        modifier_id: modifierId,
        inventory_item_id: inventoryItemId,
        qty: byIngredient.get(inventoryItemId)!,
      })),
      { onConflict: "modifier_id,inventory_item_id" },
    )
    if (upErr) return { error: upErr.message }
  }

  revalidatePath("/inventory")
  return { ok: true }
}

/**
 * Log waste / staff meal — decrements stock through adjust_inventory (which is
 * what actually moves current_qty + logs the movement). The wastage table alone
 * never moved stock, so this is the real path. Movement type feeds the report's
 * Wasted column + waste %.
 */
export async function logWaste(
  itemId: string,
  qty: number,
  kind: "wastage" | "staff_meal",
  reason: string,
): Promise<InvState> {
  await requireRole(...INV_ROLES)
  const amount = Number(qty)
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a quantity above zero." }
  const supabase = await createClient()
  // Negative delta — waste/staff-meal always removes stock.
  const { error } = await supabase.rpc("adjust_inventory", {
    _item: itemId,
    _delta: -Math.abs(amount),
    _type: kind,
    _reason: reason.trim() || (kind === "wastage" ? "Wastage" : "Staff meal"),
  })
  if (error) return { error: error.message }
  revalidatePath("/inventory")
  return { ok: true }
}

export type MovementRow = {
  id: string
  type: string
  qty: number
  reference: string | null
  created_at: string
}

/** Every stock movement for one item, newest first — explains on-hand changes. */
export async function getItemMovements(
  itemId: string,
): Promise<{ error: string } | { ok: true; movements: MovementRow[] }> {
  const tenant = await requireRole(...INV_ROLES)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("stock_movements")
    .select("id, type, qty, reference, created_at")
    .eq("tenant_id", tenant.tenantId)
    .eq("inventory_item_id", itemId)
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) return { error: error.message }
  return { ok: true, movements: (data ?? []) as MovementRow[] }
}
