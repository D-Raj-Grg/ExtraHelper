"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"

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
