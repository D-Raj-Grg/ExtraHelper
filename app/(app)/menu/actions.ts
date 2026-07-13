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
