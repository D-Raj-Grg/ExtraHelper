"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"

export type MenuState = { error: string } | { ok: true } | undefined

/** Dollars (string) → integer cents. Returns null on invalid input. */
function toCents(raw: unknown): number | null {
  const n = Number(String(raw ?? "").trim())
  if (Number.isNaN(n) || n < 0) return null
  return Math.round(n * 100)
}

export async function createCategory(
  _prev: MenuState,
  formData: FormData,
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const name = String(formData.get("name") ?? "").trim()
  if (!name) return { error: "Category name is required." }

  const supabase = await createClient()
  const { error } = await supabase.from("menu_categories").insert({
    tenant_id: tenant.tenantId,
    name,
  })
  if (error) return { error: error.message }

  revalidatePath("/menu")
  return { ok: true }
}

export async function createItem(
  _prev: MenuState,
  formData: FormData,
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const name = String(formData.get("name") ?? "").trim()
  const categoryId = String(formData.get("categoryId") ?? "").trim() || null
  const stationId = String(formData.get("stationId") ?? "").trim() || null
  const priceCents = toCents(formData.get("price"))

  if (!name) return { error: "Item name is required." }
  if (priceCents === null) return { error: "Price must be a positive number." }

  const supabase = await createClient()
  const { data: item, error } = await supabase
    .from("menu_items")
    .insert({
      tenant_id: tenant.tenantId,
      category_id: categoryId,
      name,
      base_price_cents: priceCents,
    })
    .select("id")
    .single()
  if (error) return { error: error.message }

  // Optional kitchen-station routing (KOT firing target).
  if (stationId && item) {
    const { error: routeErr } = await supabase.from("item_station_routes").insert({
      tenant_id: tenant.tenantId,
      item_id: item.id,
      station_id: stationId,
    })
    if (routeErr) return { error: routeErr.message }
  }

  revalidatePath("/menu")
  return { ok: true }
}

/** 86 = mark out of stock. Realtime disables it on all ordering surfaces later. */
export async function toggleItem86(itemId: string, is86: boolean): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager", "kitchen")
  const supabase = await createClient()
  const { error } = await supabase
    .from("menu_items")
    .update({ is_86: is86 })
    .eq("id", itemId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  revalidatePath("/pos")
  revalidatePath("/kds")
  return { ok: true }
}

export async function deleteItem(itemId: string): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  const { error } = await supabase
    .from("menu_items")
    .delete()
    .eq("id", itemId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  return { ok: true }
}

export async function createStation(
  _prev: MenuState,
  formData: FormData,
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const name = String(formData.get("name") ?? "").trim()
  if (!name) return { error: "Station name is required." }

  const supabase = await createClient()
  const { error } = await supabase.from("kitchen_stations").insert({
    tenant_id: tenant.tenantId,
    name,
  })
  if (error) return { error: error.message }
  revalidatePath("/menu")
  return { ok: true }
}

// ============================================================================
// Inline edit — items & categories
// ============================================================================

/** Update an item's core fields (name / price / category / description). */
export async function updateItem(
  itemId: string,
  fields: {
    name?: string
    price?: string
    categoryId?: string | null
    description?: string
    /**
     * Tri-state, so `undefined` (leave alone) and `null` (unmark it) have to
     * stay distinct — hence the `!== undefined` check rather than a truthiness
     * one, which would silently make "unmark" impossible.
     */
    isVeg?: boolean | null
  },
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const patch: Record<string, unknown> = {}
  if (fields.name !== undefined) {
    const name = fields.name.trim()
    if (!name) return { error: "Item name is required." }
    patch.name = name
  }
  if (fields.price !== undefined) {
    const cents = toCents(fields.price)
    if (cents === null) return { error: "Price must be a positive number." }
    patch.base_price_cents = cents
  }
  if (fields.categoryId !== undefined) patch.category_id = fields.categoryId || null
  if (fields.description !== undefined) patch.description = fields.description.trim() || null
  if (fields.isVeg !== undefined) patch.is_veg = fields.isVeg
  if (Object.keys(patch).length === 0) return { ok: true }

  const supabase = await createClient()
  const { error } = await supabase
    .from("menu_items")
    .update(patch)
    .eq("id", itemId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  revalidatePath("/pos")
  return { ok: true }
}

/** Rename / reorder / (de)activate a category. */
export async function updateCategory(
  categoryId: string,
  fields: { name?: string; sort?: number; isActive?: boolean },
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const patch: Record<string, unknown> = {}
  if (fields.name !== undefined) {
    const name = fields.name.trim()
    if (!name) return { error: "Category name is required." }
    patch.name = name
  }
  if (fields.sort !== undefined) patch.sort = fields.sort
  if (fields.isActive !== undefined) patch.is_active = fields.isActive
  if (Object.keys(patch).length === 0) return { ok: true }

  const supabase = await createClient()
  const { error } = await supabase
    .from("menu_categories")
    .update(patch)
    .eq("id", categoryId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  return { ok: true }
}

// ============================================================================
// Variants (Small / Large / Half — price delta)
// ============================================================================

export async function addVariant(
  itemId: string,
  name: string,
  priceDelta: string,
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const trimmed = name.trim()
  if (!trimmed) return { error: "Variant name is required." }
  // Delta may be negative (e.g. Half −$2), so parse without the non-negative guard.
  const n = Number(String(priceDelta ?? "0").trim())
  if (Number.isNaN(n)) return { error: "Price delta must be a number." }
  const supabase = await createClient()
  const { error } = await supabase.from("item_variants").insert({
    tenant_id: tenant.tenantId,
    item_id: itemId,
    name: trimmed,
    price_delta_cents: Math.round(n * 100),
  })
  if (error) return { error: error.message }
  revalidatePath("/menu")
  revalidatePath("/pos")
  return { ok: true }
}

export async function removeVariant(variantId: string): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  const { error } = await supabase
    .from("item_variants")
    .delete()
    .eq("id", variantId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  revalidatePath("/pos")
  return { ok: true }
}

// ============================================================================
// Modifiers (flat) + per-item links
// ============================================================================

/** Create a reusable modifier in the tenant's library. */
export async function createModifier(
  _prev: MenuState,
  formData: FormData,
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const name = String(formData.get("name") ?? "").trim()
  const priceCents = toCents(formData.get("price") ?? "0")
  if (!name) return { error: "Modifier name is required." }
  if (priceCents === null) return { error: "Price must be a positive number." }
  const supabase = await createClient()
  const { error } = await supabase.from("modifiers").insert({
    tenant_id: tenant.tenantId,
    name,
    price_cents: priceCents,
  })
  if (error) return { error: error.message }
  revalidatePath("/menu")
  return { ok: true }
}

export async function deleteModifier(modifierId: string): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  const { error } = await supabase
    .from("modifiers")
    .delete()
    .eq("id", modifierId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  return { ok: true }
}

/** Attach a modifier to an item (idempotent on the item+modifier unique key). */
export async function linkModifier(
  itemId: string,
  modifierId: string,
  opts?: { isDefault?: boolean; maxQty?: number },
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  const { error } = await supabase.from("item_modifiers").upsert(
    {
      tenant_id: tenant.tenantId,
      item_id: itemId,
      modifier_id: modifierId,
      is_default: opts?.isDefault ?? false,
      max_qty: opts?.maxQty ?? 1,
    },
    { onConflict: "item_id,modifier_id" },
  )
  if (error) return { error: error.message }
  revalidatePath("/menu")
  revalidatePath("/pos")
  return { ok: true }
}

export async function unlinkModifier(
  itemId: string,
  modifierId: string,
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  const { error } = await supabase
    .from("item_modifiers")
    .delete()
    .eq("item_id", itemId)
    .eq("modifier_id", modifierId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  revalidatePath("/pos")
  return { ok: true }
}

// ============================================================================
// Combos
// ============================================================================

export async function createCombo(
  name: string,
  price: string,
  items: { item_id: string; qty: number }[],
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const trimmed = name.trim()
  if (!trimmed) return { error: "Combo name is required." }
  const cents = toCents(price)
  if (cents === null) return { error: "Price must be a positive number." }
  if (!items.length) return { error: "Add at least one item to the combo." }
  const supabase = await createClient()
  const { error } = await supabase.from("combos").insert({
    tenant_id: tenant.tenantId,
    name: trimmed,
    price_cents: cents,
    items,
  })
  if (error) return { error: error.message }
  revalidatePath("/menu")
  return { ok: true }
}

export async function deleteCombo(comboId: string): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  const { error } = await supabase
    .from("combos")
    .delete()
    .eq("id", comboId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  return { ok: true }
}

// ============================================================================
// Image upload (Supabase Storage — bucket `menu-images`, path {tenant}/{item})
// ============================================================================

export async function uploadItemImage(
  _prev: MenuState,
  formData: FormData,
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const itemId = String(formData.get("itemId") ?? "").trim()
  const file = formData.get("file")
  if (!itemId) return { error: "Missing item." }
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image file." }
  if (file.size > 5 * 1024 * 1024) return { error: "Image must be under 5 MB." }

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "")
  // Deterministic path so re-uploads overwrite (upsert) instead of piling up.
  const path = `${tenant.tenantId}/${itemId}.${ext}`
  const supabase = await createClient()
  const { error: upErr } = await supabase.storage
    .from("menu-images")
    .upload(path, file, { upsert: true, contentType: file.type || undefined })
  if (upErr) return { error: upErr.message }

  const { data: pub } = supabase.storage.from("menu-images").getPublicUrl(path)
  // Cache-bust so the new image shows immediately after re-upload.
  const url = `${pub.publicUrl}?v=${Date.now()}`
  const { error } = await supabase
    .from("menu_items")
    .update({ image_url: url })
    .eq("id", itemId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  revalidatePath("/pos")
  return { ok: true }
}

// ============================================================================
// Per-item availability schedules
// ============================================================================

export async function addAvailability(
  itemId: string,
  dayOfWeek: number | null,
  startTime: string,
  endTime: string,
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  if (!startTime || !endTime) return { error: "Start and end time are required." }
  const supabase = await createClient()
  const { error } = await supabase.from("item_availability").insert({
    tenant_id: tenant.tenantId,
    item_id: itemId,
    day_of_week: dayOfWeek,
    start_time: startTime,
    end_time: endTime,
  })
  if (error) return { error: error.message }
  revalidatePath("/menu")
  return { ok: true }
}

export async function removeAvailability(availabilityId: string): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  const { error } = await supabase
    .from("item_availability")
    .delete()
    .eq("id", availabilityId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  return { ok: true }
}

// ============================================================================
// Wave B — Stations: multi-route editor + station rename/delete
// ============================================================================

export async function addItemStationRoute(
  itemId: string,
  stationId: string,
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  if (!stationId) return { error: "Pick a station." }
  const supabase = await createClient()
  const { error } = await supabase.from("item_station_routes").upsert(
    { tenant_id: tenant.tenantId, item_id: itemId, station_id: stationId },
    { onConflict: "item_id,station_id" },
  )
  if (error) return { error: error.message }
  revalidatePath("/menu")
  return { ok: true }
}

export async function removeItemStationRoute(
  itemId: string,
  stationId: string,
): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  const { error } = await supabase
    .from("item_station_routes")
    .delete()
    .eq("item_id", itemId)
    .eq("station_id", stationId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  return { ok: true }
}

export async function updateStation(stationId: string, name: string): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const trimmed = name.trim()
  if (!trimmed) return { error: "Station name is required." }
  const supabase = await createClient()
  const { error } = await supabase
    .from("kitchen_stations")
    .update({ name: trimmed })
    .eq("id", stationId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  return { ok: true }
}

export async function deleteStation(stationId: string): Promise<MenuState> {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  const { error } = await supabase
    .from("kitchen_stations")
    .delete()
    .eq("id", stationId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/menu")
  return { ok: true }
}
