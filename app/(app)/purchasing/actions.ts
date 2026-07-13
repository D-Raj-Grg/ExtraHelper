"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"

export type PurchState = { error: string } | { ok: true } | undefined

const PURCH_ROLES = ["owner", "manager", "inventory"] as const

export async function createSupplier(
  _prev: PurchState,
  formData: FormData,
): Promise<PurchState> {
  const tenant = await requireRole(...PURCH_ROLES)
  const name = String(formData.get("name") ?? "").trim()
  const phone = String(formData.get("phone") ?? "").trim() || null
  if (!name) return { error: "Supplier name is required." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("suppliers")
    .insert({ tenant_id: tenant.tenantId, name, phone })
  if (error) return { error: error.message }
  revalidatePath("/purchasing")
  return { ok: true }
}

export async function createPO(
  _prev: PurchState,
  formData: FormData,
): Promise<PurchState> {
  const tenant = await requireRole(...PURCH_ROLES)
  const supplierId = String(formData.get("supplierId") ?? "").trim() || null

  const supabase = await createClient()
  const { error } = await supabase.from("purchase_orders").insert({
    tenant_id: tenant.tenantId,
    supplier_id: supplierId,
    status: "draft",
  })
  if (error) return { error: error.message }
  revalidatePath("/purchasing")
  return { ok: true }
}

export async function addPOItem(
  _prev: PurchState,
  formData: FormData,
): Promise<PurchState> {
  const tenant = await requireRole(...PURCH_ROLES)
  const poId = String(formData.get("poId") ?? "").trim()
  const inventoryItemId = String(formData.get("inventoryItemId") ?? "").trim()
  const qty = Number(formData.get("qty") ?? 0)
  const cost = Math.round(Number(formData.get("cost") ?? 0) * 100)

  if (!poId || !inventoryItemId) return { error: "Pick an item." }
  if (Number.isNaN(qty) || qty <= 0) return { error: "Quantity must be positive." }

  const supabase = await createClient()
  const { error } = await supabase.from("po_items").insert({
    tenant_id: tenant.tenantId,
    po_id: poId,
    inventory_item_id: inventoryItemId,
    qty_ordered: qty,
    unit_cost_cents: Number.isNaN(cost) ? 0 : cost,
  })
  if (error) return { error: error.message }
  revalidatePath("/purchasing")
  return { ok: true }
}

/** Receive a PO in full (GRN): trusted SQL increments stock + logs movements. */
export async function receivePO(poId: string): Promise<PurchState> {
  await requireRole(...PURCH_ROLES)
  const supabase = await createClient()
  const { error } = await supabase.rpc("receive_po", { _po_id: poId })
  if (error) return { error: error.message }
  revalidatePath("/purchasing")
  revalidatePath("/inventory")
  return { ok: true }
}

/**
 * Partial GRN: receive specific quantities per line. Sets the PO to 'received'
 * when every line is fully received, otherwise 'partial'. Records unit cost on
 * each movement (feeds cost history).
 */
export async function receivePOPartial(
  poId: string,
  lines: { po_item_id: string; qty: number }[],
): Promise<PurchState> {
  await requireRole(...PURCH_ROLES)
  const clean = lines.filter((l) => l.po_item_id && Number.isFinite(l.qty) && l.qty > 0)
  if (!clean.length) return { error: "Enter a quantity to receive on at least one line." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("receive_po_partial", { _po_id: poId, _lines: clean })
  if (error) return { error: error.message }
  revalidatePath("/purchasing")
  revalidatePath("/inventory")
  return { ok: true }
}
