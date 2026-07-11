"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"

export type BillingState = { error: string } | { ok: true } | undefined

/** Subscribe/upgrade the tenant to a plan (sandbox — invoice marked paid). */
export async function subscribe(
  planCode: string,
  interval: "month" | "year",
): Promise<BillingState> {
  const tenant = await requireRole("owner")
  const supabase = await createClient()
  const { error } = await supabase.rpc("subscribe_tenant", {
    _tenant: tenant.tenantId,
    _plan_code: planCode,
    _interval: interval,
  })
  if (error) return { error: error.message }
  revalidatePath("/billing")
  return { ok: true }
}
