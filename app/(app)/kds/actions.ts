"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import type { KotStatus } from "@/lib/kds-constants"

export type KdsState = { error: string } | { ok: true } | undefined

/** Advance (bump) a KOT ticket + its items to a new status. */
export async function bumpKot(kotId: string, status: KotStatus): Promise<KdsState> {
  const tenant = await requireRole("owner", "manager", "kitchen")
  const supabase = await createClient()

  const { error } = await supabase
    .from("kots")
    .update({ status })
    .eq("id", kotId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  // Keep item statuses in step with the ticket.
  await supabase
    .from("kot_items")
    .update({ status })
    .eq("kot_id", kotId)
    .eq("tenant_id", tenant.tenantId)

  // Propagate ticket progress up to the parent order status.
  const { data: kot } = await supabase
    .from("kots")
    .select("order_id")
    .eq("id", kotId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  if (kot?.order_id) await supabase.rpc("sync_order_status_from_kots", { _order_id: kot.order_id })

  revalidatePath("/kds")
  // The POS KOT tab reads the same tickets — keep its server-seeded list fresh.
  revalidatePath("/pos")
  return { ok: true }
}

/** Waiter marks an order delivered — advances order + tickets to served. */
export async function markServed(orderId: string): Promise<KdsState> {
  await requireRole("owner", "manager", "kitchen", "waiter", "cashier")
  const supabase = await createClient()
  const { error } = await supabase.rpc("mark_order_served", { _order_id: orderId })
  if (error) return { error: error.message }
  revalidatePath("/kds")
  revalidatePath("/pos")
  return { ok: true }
}

/** Stamp a KOT as printed (fed by the browser print view). Idempotent-ish. */
export async function markKotPrinted(kotId: string): Promise<KdsState> {
  const tenant = await requireRole("owner", "manager", "kitchen", "waiter", "cashier")
  const supabase = await createClient()
  const { error } = await supabase
    .from("kots")
    .update({ printed_at: new Date().toISOString() })
    .eq("id", kotId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  return { ok: true }
}

/** Recall a bumped ticket back onto the board (served/ready → preparing). */
export async function recallKot(kotId: string): Promise<KdsState> {
  const tenant = await requireRole("owner", "manager", "kitchen")
  const supabase = await createClient()

  const { error } = await supabase
    .from("kots")
    .update({ status: "preparing" })
    .eq("id", kotId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  await supabase
    .from("kot_items")
    .update({ status: "preparing" })
    .eq("kot_id", kotId)
    .eq("tenant_id", tenant.tenantId)

  const { data: kot } = await supabase
    .from("kots")
    .select("order_id")
    .eq("id", kotId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  if (kot?.order_id) await supabase.rpc("sync_order_status_from_kots", { _order_id: kot.order_id })

  revalidatePath("/kds")
  return { ok: true }
}
