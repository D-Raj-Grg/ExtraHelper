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

  revalidatePath("/kds")
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

  revalidatePath("/kds")
  return { ok: true }
}
