"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requirePlatformAdmin } from "@/lib/supabase/guards"
import { writeAudit } from "@/lib/supabase/audit"

/**
 * Suspend or reactivate a tenant. Platform-admin only (guard + RLS both enforce).
 * Audited (rule #5) — impersonation/suspension are sensitive platform actions.
 */
export async function setTenantStatus(
  tenantId: string,
  action: "suspend" | "activate",
): Promise<{ error: string | null }> {
  await requirePlatformAdmin()

  const status = action === "suspend" ? "suspended" : "active"
  const supabase = await createClient()
  const { error } = await supabase
    .from("tenants")
    .update({ status })
    .eq("id", tenantId)
  if (error) return { error: error.message }

  await writeAudit({
    tenantId,
    action: action === "suspend" ? "tenant_suspend" : "tenant_activate",
    entityType: "tenant",
    entityId: tenantId,
  })

  revalidatePath("/admin")
  return { error: null }
}

/** Platform admin assigns a plan to a tenant (audited via subscribe path). */
export async function setTenantPlan(
  tenantId: string,
  planCode: string,
): Promise<{ error: string | null }> {
  await requirePlatformAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc("subscribe_tenant", {
    _tenant: tenantId,
    _plan_code: planCode,
    _interval: "month",
  })
  if (error) return { error: error.message }

  await writeAudit({
    tenantId,
    action: "role_change",
    entityType: "subscription",
    entityId: tenantId,
    metadata: { plan: planCode, by: "platform_admin" },
  })

  revalidatePath("/admin")
  return { error: null }
}
