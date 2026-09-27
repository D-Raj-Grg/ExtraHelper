"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requirePermission, requireRole } from "@/lib/supabase/guards"

export type LoyaltyState = { error: string } | { ok: true } | undefined

/** Earn or redeem loyalty points for a customer (manager-gated, trusted). */
export async function adjustPoints(
  customerId: string,
  points: number,
  type: "earn" | "burn",
): Promise<LoyaltyState> {
  await requireRole("owner", "manager")
  if (!Number.isInteger(points) || points <= 0)
    return { error: "Points must be a positive whole number." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("loyalty_adjust", {
    _customer_id: customerId,
    _points: points,
    _type: type,
    _reference: type === "earn" ? "manual earn" : "manual redeem",
  })
  if (error) return { error: error.message }
  revalidatePath("/loyalty")
  return { ok: true }
}

// The three below are thin: the RPC checks `loyalty.edit` again, validates,
// refuses a duplicate phone, and writes the audit row. `requirePermission` is
// the UX gate (redirect, not a 500) — the database is the floor.

/** Edit a customer's name, phone and email. */
export async function updateCustomer(
  _prev: LoyaltyState,
  formData: FormData,
): Promise<LoyaltyState> {
  await requirePermission("loyalty.edit")
  const id = String(formData.get("id") ?? "")
  if (!id) return { error: "Customer not found." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_customer", {
    _customer_id: id,
    _name: String(formData.get("name") ?? ""),
    _phone: String(formData.get("phone") ?? ""),
    _email: String(formData.get("email") ?? ""),
  })
  if (error) return { error: error.message }
  revalidatePath("/loyalty")
  return { ok: true }
}

/** Delete a customer. Their orders survive without a name; points are gone. */
export async function deleteCustomer(customerId: string): Promise<LoyaltyState> {
  await requirePermission("loyalty.edit")
  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_customer", { _customer_id: customerId })
  if (error) return { error: error.message }
  revalidatePath("/loyalty")
  return { ok: true }
}

/** Fold `dropId` into `keepId`: orders, reservations, feedback and points move. */
export async function mergeCustomers(keepId: string, dropId: string): Promise<LoyaltyState> {
  await requirePermission("loyalty.edit")
  if (keepId === dropId) return { error: "Pick two different customers." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("merge_customers", { _keep_id: keepId, _drop_id: dropId })
  if (error) return { error: error.message }
  revalidatePath("/loyalty")
  return { ok: true }
}
