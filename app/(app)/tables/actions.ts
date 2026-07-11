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
  await requireRole("owner", "manager", "receptionist", "waiter", "cashier")
  if (!TABLE_STATES.includes(state)) return { error: "Invalid state." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("restaurant_tables")
    .update({ state })
    .eq("id", tableId)
  if (error) return { error: error.message }
  revalidatePath("/tables")
  return { ok: true }
}

export async function deleteTable(tableId: string): Promise<TablesState> {
  await requireRole("owner", "manager")
  const supabase = await createClient()
  const { error } = await supabase
    .from("restaurant_tables")
    .delete()
    .eq("id", tableId)
  if (error) return { error: error.message }
  revalidatePath("/tables")
  return { ok: true }
}
