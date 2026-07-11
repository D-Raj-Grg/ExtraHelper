"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { ONLINE_STATES, type OnlineStatus } from "@/lib/online-constants"

export type OnlineState = { error: string } | { ok: true } | undefined

const ONLINE_ROLES = ["owner", "manager", "cashier"] as const

/** Advance an online order's status (tenant-scoped). */
export async function setOnlineStatus(
  id: string,
  status: OnlineStatus,
): Promise<OnlineState> {
  const tenant = await requireRole(...ONLINE_ROLES)
  if (!ONLINE_STATES.includes(status)) return { error: "Invalid status." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("online_orders")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/online")
  return { ok: true }
}

/** Dispatch a delivery: record driver + set status out_for_delivery. */
export async function dispatchDelivery(
  onlineOrderId: string,
  driver: string,
): Promise<OnlineState> {
  const tenant = await requireRole(...ONLINE_ROLES)
  if (!driver.trim()) return { error: "Driver name is required." }

  const supabase = await createClient()
  const { error: trackErr } = await supabase.from("delivery_tracking").insert({
    tenant_id: tenant.tenantId,
    online_order_id: onlineOrderId,
    status: "dispatched",
    driver_name: driver,
  })
  if (trackErr) return { error: trackErr.message }

  const { error } = await supabase
    .from("online_orders")
    .update({ status: "out_for_delivery" })
    .eq("id", onlineOrderId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }

  revalidatePath("/online")
  return { ok: true }
}
