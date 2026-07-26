"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { TABLE_STATES, type TableState } from "@/lib/table-constants"

export type TablesState = { error: string } | { ok: true } | undefined

export async function createFloor(
  _prev: TablesState,
  formData: FormData,
): Promise<TablesState> {
  const tenant = await requireRole("owner", "manager")
  const name = String(formData.get("name") ?? "").trim()
  if (!name) return { error: "Floor name is required." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("floors")
    .insert({ tenant_id: tenant.tenantId, name })
  if (error) return { error: error.message }
  revalidatePath("/tables")
  return { ok: true }
}

export async function createTable(
  _prev: TablesState,
  formData: FormData,
): Promise<TablesState> {
  const tenant = await requireRole("owner", "manager")
  const label = String(formData.get("label") ?? "").trim()
  const floorId = String(formData.get("floorId") ?? "").trim() || null
  const capacity = Number(formData.get("capacity") ?? 0)

  if (!label) return { error: "Table label is required." }
  if (!Number.isInteger(capacity) || capacity < 1)
    return { error: "Capacity must be a positive whole number." }

  const supabase = await createClient()
  // qr_token defaults to gen_random_uuid() in the DB — stable per table.
  const { error } = await supabase.from("restaurant_tables").insert({
    tenant_id: tenant.tenantId,
    floor_id: floorId,
    label,
    capacity,
  })
  if (error) return { error: error.message }
  revalidatePath("/tables")
  return { ok: true }
}

export async function setTableState(
  tableId: string,
  state: TableState,
): Promise<TablesState> {
  const tenant = await requireRole("owner", "manager", "receptionist", "waiter", "cashier")
  if (!TABLE_STATES.includes(state)) return { error: "Invalid state." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("restaurant_tables")
    .update({ state })
    .eq("id", tableId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/tables")
  return { ok: true }
}

/** Persist a table's position on the visual floor map (drag-and-drop). */
export async function updateTablePosition(
  tableId: string,
  x: number,
  y: number,
): Promise<TablesState> {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  const { error } = await supabase
    .from("restaurant_tables")
    .update({ pos_x: Math.round(x), pos_y: Math.round(y) })
    .eq("id", tableId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/tables")
  return { ok: true }
}

/** Resolve the current active (non-closed/cancelled) order on a table. */
async function activeOrderForTable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  tableId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("table_id", tableId)
    .not("status", "in", "(closed,cancelled)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

/** Move a table's active order to another table (transfer). */
export async function transferTable(
  fromTableId: string,
  toTableId: string,
): Promise<TablesState> {
  const tenant = await requireRole("owner", "manager", "receptionist", "waiter", "cashier")
  if (fromTableId === toTableId) return { error: "Pick a different table." }
  const supabase = await createClient()
  const orderId = await activeOrderForTable(supabase, tenant.tenantId, fromTableId)
  if (!orderId) return { error: "That table has no active order." }
  const { error } = await supabase.rpc("transfer_order", {
    _order_id: orderId,
    _to_table: toTableId,
  })
  if (error) return { error: error.message }
  revalidatePath("/tables")
  return { ok: true }
}

/** Merge two tables' orders onto one combined bill. Returns the bill id. */
export async function mergeTables(
  primaryTableId: string,
  otherTableId: string,
): Promise<{ error: string } | { ok: true; billId: string }> {
  const tenant = await requireRole("owner", "manager", "cashier")
  if (primaryTableId === otherTableId) return { error: "Pick two different tables." }
  const supabase = await createClient()
  const [primaryOrder, otherOrder] = await Promise.all([
    activeOrderForTable(supabase, tenant.tenantId, primaryTableId),
    activeOrderForTable(supabase, tenant.tenantId, otherTableId),
  ])
  if (!primaryOrder || !otherOrder) return { error: "Both tables need an active order to merge." }
  const { data: billId, error } = await supabase.rpc("create_bill_for_order", {
    _order_id: primaryOrder,
  })
  if (error || !billId) return { error: error?.message ?? "Could not open a bill." }
  const { error: addErr } = await supabase.rpc("add_order_to_bill", {
    _bill_id: billId as string,
    _order_id: otherOrder,
  })
  if (addErr) return { error: addErr.message }
  revalidatePath("/tables")
  return { ok: true, billId: billId as string }
}

/** Split selected items off a table's order to a new order on another table. */
export async function splitTable(
  fromTableId: string,
  toTableId: string | null,
  itemIds: string[],
): Promise<TablesState> {
  const tenant = await requireRole("owner", "manager", "receptionist", "waiter", "cashier")
  if (!itemIds.length) return { error: "Select at least one item to split." }
  const supabase = await createClient()
  const orderId = await activeOrderForTable(supabase, tenant.tenantId, fromTableId)
  if (!orderId) return { error: "That table has no active order." }
  const { error } = await supabase.rpc("split_order_items", {
    _order_id: orderId,
    _to_table: toTableId,
    _item_ids: itemIds,
  })
  if (error) return { error: error.message }
  revalidatePath("/tables")
  return { ok: true }
}

export async function deleteTable(tableId: string): Promise<TablesState> {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  const { error } = await supabase
    .from("restaurant_tables")
    .delete()
    .eq("id", tableId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/tables")
  return { ok: true }
}
