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
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from("orders")
    .insert({
      tenant_id: tenant.tenantId,
      table_id: tableId,
      order_type: orderType,
      status: "draft",
      waiter_id: user?.id ?? null,
    })
    .select("id")
    .single()
  if (error || !data) redirect("/pos")

  if (tableId) {
    await supabase
      .from("restaurant_tables")
      .update({ state: "occupied" })
      .eq("id", tableId)
      .eq("tenant_id", tenant.tenantId)
  }
  redirect(`/pos/${data.id}`)
}

export type AddItemOpts = {
  variantId?: string | null
  modifierIds?: string[]
  notes?: string | null
  course?: number | null
  seat?: number | null
  qty?: number
}

/**
 * Add a menu item to a draft order. Snapshots name + price at add time,
 * folding in the chosen variant delta and modifier prices. Modifiers are
 * recorded on `order_item_modifiers` for the kitchen ticket + receipt.
 */
export async function addItem(
  orderId: string,
  itemId: string,
  opts: AddItemOpts = {},
): Promise<PosState> {
  const tenant = await requireRole(...ORDER_ROLES)
  const supabase = await createClient()

  const { data: item, error: itemErr } = await supabase
    .from("menu_items")
    .select("name, base_price_cents, is_86")
    .eq("id", itemId)
    .eq("tenant_id", tenant.tenantId)
    .single()
  if (itemErr || !item) return { error: "Item not found." }
  if (item.is_86) return { error: `${item.name} is 86'd (out of stock).` }

  const qty = Math.max(1, Math.floor(opts.qty ?? 1))
  let unitPrice = item.base_price_cents
  let nameSnapshot = item.name

  // Variant: fold price delta + append name (validated to belong to this item).
  if (opts.variantId) {
    const { data: variant } = await supabase
      .from("item_variants")
      .select("name, price_delta_cents")
      .eq("id", opts.variantId)
      .eq("item_id", itemId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle()
    if (!variant) return { error: "Variant not found." }
    unitPrice += variant.price_delta_cents
    nameSnapshot = `${item.name} (${variant.name})`
  }

  // Modifiers: fetch trusted prices, fold into unit price.
  const modifierIds = [...new Set(opts.modifierIds ?? [])]
  let mods: { id: string; name: string; price_cents: number }[] = []
  if (modifierIds.length) {
    const { data: rows } = await supabase
      .from("modifiers")
      .select("id, name, price_cents")
      .eq("tenant_id", tenant.tenantId)
      .in("id", modifierIds)
    mods = rows ?? []
    unitPrice += mods.reduce((s, m) => s + m.price_cents, 0)
  }

  const { data: line, error } = await supabase
    .from("order_items")
    .insert({
      tenant_id: tenant.tenantId,
      order_id: orderId,
      item_id: itemId,
      variant_id: opts.variantId ?? null,
      name_snapshot: nameSnapshot,
      qty,
      unit_price_cents: unitPrice,
      notes: opts.notes?.trim() || null,
      course: opts.course ?? null,
      seat: opts.seat ?? null,
      status: "draft",
    })
    .select("id")
    .single()
  if (error || !line) return { error: error?.message ?? "Could not add item." }

  if (mods.length) {
    const { error: modErr } = await supabase.from("order_item_modifiers").insert(
      mods.map((m) => ({
        tenant_id: tenant.tenantId,
        order_item_id: line.id,
        modifier_id: m.id,
        name_snapshot: m.name,
        qty: 1,
        price_cents: m.price_cents,
      })),
    )
    if (modErr) return { error: modErr.message }
  }

  revalidatePath(`/pos/${orderId}`)
  return { ok: true }
}

/** Change a line's quantity (min 1). Editable states only. */
export async function setLineQty(
  orderId: string,
  orderItemId: string,
  qty: number,
): Promise<PosState> {
  const tenant = await requireRole(...ORDER_ROLES)
  const next = Math.max(1, Math.floor(qty))
  const supabase = await createClient()
  const { error } = await supabase
    .from("order_items")
    .update({ qty: next })
    .eq("id", orderItemId)
    .eq("tenant_id", tenant.tenantId)
    .in("status", ["draft", "placed"])
  if (error) return { error: error.message }
  revalidatePath(`/pos/${orderId}`)
  return { ok: true }
}

/** Edit a line's notes / course / seat. */
export async function updateLine(
  orderId: string,
  orderItemId: string,
  fields: { notes?: string | null; course?: number | null; seat?: number | null },
): Promise<PosState> {
  const tenant = await requireRole(...ORDER_ROLES)
  const patch: Record<string, unknown> = {}
  if (fields.notes !== undefined) patch.notes = fields.notes?.trim() || null
  if (fields.course !== undefined) patch.course = fields.course
  if (fields.seat !== undefined) patch.seat = fields.seat
  if (Object.keys(patch).length === 0) return { ok: true }
  const supabase = await createClient()
  const { error } = await supabase
    .from("order_items")
    .update(patch)
    .eq("id", orderItemId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath(`/pos/${orderId}`)
  return { ok: true }
}

/** Stage/unstage a line — held lines are not fired to the kitchen. */
export async function setLineHold(
  orderId: string,
  orderItemId: string,
  hold: boolean,
): Promise<PosState> {
  const tenant = await requireRole(...ORDER_ROLES)
  const supabase = await createClient()
  const { error } = await supabase
    .from("order_items")
    .update({ is_held: hold })
    .eq("id", orderItemId)
    .eq("tenant_id", tenant.tenantId)
    .in("status", ["draft", "placed"])
  if (error) return { error: error.message }
  revalidatePath(`/pos/${orderId}`)
  return { ok: true }
}

/** Void a line (manager approval + reason + audit + stock restore) via RPC. */
export async function voidLine(
  orderId: string,
  orderItemId: string,
  reason: string,
): Promise<PosState> {
  await requireRole(...ORDER_ROLES)
  if (!reason.trim()) return { error: "Void reason is required." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("void_order_item", {
    _order_item_id: orderItemId,
    _reason: reason.trim(),
  })
  if (error) return { error: error.message }
  revalidatePath(`/pos/${orderId}`)
  return { ok: true }
}

export async function removeItem(orderId: string, orderItemId: string): Promise<PosState> {
  const tenant = await requireRole(...ORDER_ROLES)
  const supabase = await createClient()
  const { error } = await supabase
    .from("order_items")
    .delete()
    .eq("id", orderItemId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath(`/pos/${orderId}`)
  return { ok: true }
}

/**
 * Place a full order (table + items) atomically with a client-supplied
 * idempotency key. This is the offline-queue replay path — dedups on
 * orders.unique(tenant_id, idempotency_key). Returns the order id.
 */
export async function placeStaffOrder(
  idempotencyKey: string,
  tableId: string | null,
  items: { item_id: string; qty: number }[],
): Promise<{ error: string } | { ok: true; orderId: string }> {
  const tenant = await requireRole(...ORDER_ROLES)
  if (!idempotencyKey) return { error: "Missing idempotency key." }
  if (!items?.length) return { error: "No items." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("place_staff_order", {
    _tenant: tenant.tenantId,
    _idempotency_key: idempotencyKey,
    _table_id: tableId,
    _order_type: tableId ? "dine_in" : "pickup",
    _items: items,
  })
  if (error) return { error: error.message }

  revalidatePath("/pos")
  return { ok: true, orderId: data as string }
}

/** Fire the order to the kitchen — splits into per-station KOTs (trusted fn). */
export async function fireOrder(
  orderId: string,
): Promise<{ error: string } | { ok: true; kotIds: string[] }> {
  const tenant = await requireRole(...ORDER_ROLES)
  const supabase = await createClient()
  const { error } = await supabase.rpc("fire_order", { _order_id: orderId })
  if (error) return { error: error.message }
  // Re-query the freshly created tickets so the client can print them. Scope to
  // unprinted + unbumped so a re-fire (added items) won't reprint earlier KOTs.
  const { data: kots } = await supabase
    .from("kots")
    .select("id")
    .eq("tenant_id", tenant.tenantId)
    .eq("order_id", orderId)
    .eq("status", "new")
    .is("printed_at", null)
  revalidatePath(`/pos/${orderId}`)
  return { ok: true, kotIds: (kots ?? []).map((k) => k.id) }
}
