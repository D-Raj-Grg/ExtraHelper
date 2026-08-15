"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { SUPPLIER_METHODS, type SupplierMethod } from "@/lib/purchasing-constants"

export type PurchState = { error: string } | { ok: true } | undefined

/**
 * Every write here checks `purchasing.edit`, not a base role.
 *
 * The old `requireRole("owner","manager","inventory")` checked the *base* role,
 * so a custom role built on `inventory` with `purchasing.edit` deliberately
 * revoked still passed it. RLS and the RPCs are keyed on the permission, so the
 * action and the database would disagree and the user would get a raw Postgres
 * error instead of a sentence.
 *
 * Destructive actions stop here too. Their `purchasing.delete` check lives in
 * the RPC, in one place, so it cannot drift from the policy — and the button is
 * already hidden without it.
 */
async function guard() {
  const tenant = await requirePermission("purchasing.edit")
  const supabase = await createClient()
  return { tenant, supabase }
}

function revalidate(alsoInventory = false, alsoCash = false) {
  revalidatePath("/purchasing")
  if (alsoInventory) revalidatePath("/inventory")
  if (alsoCash) revalidatePath("/cash")
}

/** Narrow a PostgREST/RPC failure to its message, which the RPCs write for humans. */
function fail(error: { message: string } | null): PurchState {
  return error ? { error: error.message } : { ok: true }
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function createSupplier(_prev: PurchState, formData: FormData): Promise<PurchState> {
  const { tenant, supabase } = await guard()
  const name = String(formData.get("name") ?? "").trim()
  if (!name) return { error: "Supplier name is required." }

  const { error } = await supabase.from("suppliers").insert({
    tenant_id: tenant.tenantId,
    name,
    contact: String(formData.get("contact") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
  })
  revalidate()
  return fail(error)
}

export async function updateSupplier(_prev: PurchState, formData: FormData): Promise<PurchState> {
  const { tenant, supabase } = await guard()
  const id = String(formData.get("supplierId") ?? "")
  const name = String(formData.get("name") ?? "").trim()
  if (!id) return { error: "No supplier selected." }
  if (!name) return { error: "Supplier name is required." }

  const { error } = await supabase
    .from("suppliers")
    .update({
      name,
      contact: String(formData.get("contact") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
    })
    .eq("id", id)
    .eq("tenant_id", tenant.tenantId)
  revalidate()
  return fail(error)
}

/** Rename only — the inline case, so the row doesn't need the whole sheet. */
export async function renameSupplier(id: string, name: string): Promise<PurchState> {
  const { tenant, supabase } = await guard()
  if (!name.trim()) return { error: "Supplier name is required." }
  const { error } = await supabase
    .from("suppliers")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("tenant_id", tenant.tenantId)
  revalidate()
  return fail(error)
}

export async function setSupplierArchived(id: string, archived: boolean): Promise<PurchState> {
  const { tenant, supabase } = await guard()
  const { error } = await supabase
    .from("suppliers")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("tenant_id", tenant.tenantId)
  revalidate()
  return fail(error)
}

/** Refuses unless archived, unused, and the caller holds `purchasing.delete`. */
export async function deleteSupplier(id: string): Promise<PurchState> {
  const { supabase } = await guard()
  const { error } = await supabase.rpc("delete_supplier", { _supplier_id: id })
  revalidate()
  return fail(error)
}

/** A supplier's own orders and payments — fetched when their sheet opens. */
export async function getSupplierDetail(id: string) {
  const tenant = await requirePermission("purchasing.view")
  const supabase = await createClient()
  const [{ data: orders }, { data: payments }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, status, created_at, po_items(qty_ordered, qty_received, unit_cost_cents)")
      .eq("tenant_id", tenant.tenantId)
      .eq("supplier_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("supplier_payments")
      .select("id, amount_cents, method, paid_at, note, voided_at")
      .eq("tenant_id", tenant.tenantId)
      .eq("supplier_id", id)
      .order("paid_at", { ascending: false })
      .limit(20),
  ])
  return { orders: orders ?? [], payments: payments ?? [] }
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function createPO(_prev: PurchState, formData: FormData): Promise<PurchState> {
  const { tenant, supabase } = await guard()
  const supplierId = String(formData.get("supplierId") ?? "").trim() || null
  const { error } = await supabase.rpc("create_po", {
    _tenant: tenant.tenantId,
    _supplier_id: supplierId,
  })
  revalidate()
  return fail(error)
}

export async function setPOSupplier(poId: string, supplierId: string | null): Promise<PurchState> {
  const { supabase } = await guard()
  const { error } = await supabase.rpc("set_po_supplier", {
    _po_id: poId,
    _supplier_id: supplierId,
  })
  revalidate()
  return fail(error)
}

export async function sendPO(poId: string): Promise<PurchState> {
  const { supabase } = await guard()
  const { error } = await supabase.rpc("send_po", { _po_id: poId })
  revalidate()
  return fail(error)
}

export async function reopenPO(poId: string): Promise<PurchState> {
  const { supabase } = await guard()
  const { error } = await supabase.rpc("reopen_po", { _po_id: poId })
  revalidate()
  return fail(error)
}

export async function cancelPO(poId: string, reason: string): Promise<PurchState> {
  const { supabase } = await guard()
  const { error } = await supabase.rpc("cancel_po", { _po_id: poId, _reason: reason || null })
  revalidate()
  return fail(error)
}

export async function deletePO(poId: string): Promise<PurchState> {
  const { supabase } = await guard()
  const { error } = await supabase.rpc("delete_po", { _po_id: poId })
  revalidate()
  return fail(error)
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export async function addPOLine(
  poId: string,
  inventoryItemId: string,
  qty: number,
  unitCost: number,
): Promise<PurchState> {
  const { supabase } = await guard()
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Quantity must be more than zero." }
  const { error } = await supabase.rpc("add_po_line", {
    _po_id: poId,
    _inventory_item_id: inventoryItemId,
    _qty: qty,
    _unit_cost_cents: Math.round((Number.isFinite(unitCost) ? unitCost : 0) * 100),
  })
  revalidate()
  return fail(error)
}

/**
 * Create an ingredient and put it straight on the order.
 *
 * Name and unit only — everything else defaults. Leaving the screen to set up
 * an item mid-receipt is the main reason a 20 rupee packet of noodles never
 * gets logged at all. The full record is still editable on /inventory.
 */
export async function createItemAndAddLine(
  poId: string,
  name: string,
  uom: string,
  qty: number,
  unitCost: number,
): Promise<PurchState> {
  const { tenant, supabase } = await guard()
  const clean = name.trim()
  if (!clean) return { error: "Give the ingredient a name." }

  const { data: item, error: itemError } = await supabase
    .from("inventory_items")
    .insert({ tenant_id: tenant.tenantId, name: clean, uom: uom.trim() || "unit" })
    .select("id")
    .single()
  if (itemError) return { error: itemError.message }

  const { error } = await supabase.rpc("add_po_line", {
    _po_id: poId,
    _inventory_item_id: item.id,
    _qty: qty,
    _unit_cost_cents: Math.round((Number.isFinite(unitCost) ? unitCost : 0) * 100),
  })
  revalidate(true)
  return fail(error)
}

export async function updatePOLine(
  lineId: string,
  qty: number,
  unitCost: number,
): Promise<PurchState> {
  const { supabase } = await guard()
  const { error } = await supabase.rpc("update_po_line", {
    _line_id: lineId,
    _qty: qty,
    _unit_cost_cents: Math.round((Number.isFinite(unitCost) ? unitCost : 0) * 100),
  })
  revalidate()
  return fail(error)
}

export async function deletePOLine(lineId: string): Promise<PurchState> {
  const { supabase } = await guard()
  const { error } = await supabase.rpc("delete_po_line", { _line_id: lineId })
  revalidate()
  return fail(error)
}

/** The lines of one order — fetched when its sheet opens, not with the list. */
export async function getPOLines(poId: string) {
  await requirePermission("purchasing.view")
  const supabase = await createClient()
  const { data } = await supabase
    .from("po_items")
    .select("id, qty_ordered, qty_received, unit_cost_cents, inventory_items(id, name, uom)")
    .eq("po_id", poId)
    .order("id")
  return data ?? []
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

export async function receivePO(poId: string): Promise<PurchState> {
  const { supabase } = await guard()
  const { error } = await supabase.rpc("receive_po", { _po_id: poId })
  revalidate(true)
  return fail(error)
}

export async function receivePOPartial(
  poId: string,
  lines: { po_item_id: string; qty: number }[],
): Promise<PurchState> {
  const { supabase } = await guard()
  const clean = lines.filter((l) => l.po_item_id && Number.isFinite(l.qty) && l.qty > 0)
  if (!clean.length) return { error: "Enter a quantity to receive on at least one line." }
  const { error } = await supabase.rpc("receive_po_partial", { _po_id: poId, _lines: clean })
  revalidate(true)
  return fail(error)
}

/** Correction, not undo — writes a compensating movement and keeps the original. */
export async function correctPOReceipt(
  lineId: string,
  newQty: number,
  newUnitCost: number | null,
  reason: string,
): Promise<PurchState> {
  const { supabase } = await guard()
  if (!reason.trim()) return { error: "Say what went wrong." }
  const { error } = await supabase.rpc("correct_po_receipt", {
    _line_id: lineId,
    _new_qty_received: newQty,
    _new_unit_cost_cents: newUnitCost === null ? null : Math.round(newUnitCost * 100),
    _reason: reason.trim(),
  })
  revalidate(true)
  return fail(error)
}

/**
 * Draft a purchase order for everything at or below reorder, grouped by
 * supplier. Returns how many drafts were created.
 */
export async function createDraftPOFromLowStock(): Promise<
  { error: string } | { ok: true; created: number }
> {
  const { tenant, supabase } = await guard()
  const { data, error } = await supabase.rpc("create_draft_po_from_reorder", {
    _tenant: tenant.tenantId,
  })
  if (error) return { error: error.message }
  revalidate(true)
  return { ok: true, created: (data as number) ?? 0 }
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export async function recordSupplierPayment(
  _prev: PurchState,
  formData: FormData,
): Promise<PurchState> {
  const { supabase } = await guard()
  const supplierId = String(formData.get("supplierId") ?? "").trim()
  const poId = String(formData.get("poId") ?? "").trim() || null
  const method = String(formData.get("method") ?? "").trim()
  const note = String(formData.get("note") ?? "").trim() || null
  const paidAt = String(formData.get("paidAt") ?? "").trim() || null
  const amountCents = Math.round(Number(formData.get("amount") ?? 0) * 100)

  if (!supplierId) return { error: "Pick a supplier." }
  if (!SUPPLIER_METHODS.includes(method as SupplierMethod))
    return { error: "Pick how it was paid." }
  if (!Number.isFinite(amountCents) || amountCents <= 0)
    return { error: "Amount must be more than zero." }

  const { error } = await supabase.rpc("record_supplier_payment", {
    _supplier_id: supplierId,
    _po_id: poId,
    _amount_cents: amountCents,
    _method: method as SupplierMethod,
    // Date-only input: anchor to midday so a timezone shift can't move the day.
    _paid_at: paidAt ? new Date(`${paidAt}T12:00:00`).toISOString() : null,
    _note: note,
  })
  revalidate(false, true)
  return fail(error)
}

export async function voidSupplierPayment(id: string, reason: string): Promise<PurchState> {
  const { supabase } = await guard()
  if (!reason.trim()) return { error: "Say why you're voiding it." }
  const { error } = await supabase.rpc("void_supplier_payment", {
    _payment_id: id,
    _reason: reason.trim(),
  })
  revalidate(false, true)
  return fail(error)
}
