"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requirePlatformAdmin } from "@/lib/supabase/guards"
import { writeAudit } from "@/lib/supabase/audit"
import { IMPERSONATE_COOKIE } from "@/lib/supabase/tenant"

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

/**
 * Start impersonating a tenant (platform-admin "view as"). Sets a cookie that
 * getActiveTenant honors only for platform admins; audited against the target.
 */
export async function startImpersonation(tenantId: string): Promise<void> {
  await requirePlatformAdmin()
  const store = await cookies()
  store.set(IMPERSONATE_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 4, // 4h safety expiry
  })
  await writeAudit({
    tenantId,
    action: "impersonate",
    entityType: "tenant",
    entityId: tenantId,
    metadata: { event: "start" },
  })
  redirect("/")
}

/** Stop impersonating and return to the admin console. */
export async function stopImpersonation(): Promise<void> {
  const store = await cookies()
  const tenantId = store.get(IMPERSONATE_COOKIE)?.value
  store.delete(IMPERSONATE_COOKIE)
  if (tenantId) {
    await writeAudit({
      tenantId,
      action: "impersonate",
      entityType: "tenant",
      entityId: tenantId,
      metadata: { event: "stop" },
    })
  }
  redirect("/admin")
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
