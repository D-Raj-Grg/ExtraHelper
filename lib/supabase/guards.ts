import { redirect } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { getActiveTenant, type ActiveTenant } from "@/lib/supabase/tenant"

/** Per-tenant staff roles (mirrors the `app_role` enum in the database). */
export type AppRole =
  | "owner"
  | "manager"
  | "receptionist"
  | "cashier"
  | "waiter"
  | "kitchen"
  | "inventory"

/**
 * App-level RBAC guards. These are convenience/UX gates for Server Components and
 * Server Actions — the database RLS policies remain the real source of truth
 * (rule #1). Never rely on these alone for isolation.
 */

/** The signed-in user, or redirect to /login. */
export async function requireUser(): Promise<User> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  return user
}

/** The user's active tenant, or redirect to /onboarding if they have none. */
export async function requireTenant(): Promise<ActiveTenant> {
  await requireUser()
  const tenant = await getActiveTenant()
  if (!tenant) redirect("/onboarding")
  return tenant
}

/**
 * Require that the active tenant membership carries one of `roles`.
 * Redirects to home on mismatch (unauthorized). Returns the tenant.
 */
export async function requireRole(
  ...roles: AppRole[]
): Promise<ActiveTenant> {
  const tenant = await requireTenant()
  if (roles.length && !roles.includes(tenant.role as AppRole)) {
    redirect("/")
  }
  return tenant
}

/**
 * Require the active tenant membership to hold permission `key` (custom role or
 * base-role default). Redirects home on deny. Returns the tenant. This refines
 * within the base role — RLS remains the security floor.
 */
export async function requirePermission(key: string): Promise<ActiveTenant> {
  const tenant = await requireTenant()
  const supabase = await createClient()
  const { data } = await supabase.rpc("has_permission", {
    _tenant: tenant.tenantId,
    _key: key,
  })
  if (data !== true) redirect("/")
  return tenant
}

/** Is the signed-in user a platform super admin? */
export async function isPlatformAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("is_platform_admin")
  return data === true
}

/** Require platform super admin, else redirect to home. */
export async function requirePlatformAdmin(): Promise<User> {
  const user = await requireUser()
  if (!(await isPlatformAdmin())) redirect("/")
  return user
}

/** Is a plan feature enabled for the given tenant? (subscription plan / trial). */
export async function tenantHasFeature(
  tenantId: string,
  key: string,
): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("tenant_has_feature", {
    _tenant: tenantId,
    _key: key,
  })
  return data === true
}

/**
 * Require the active tenant's plan to include `feature`, else redirect to
 * /billing (upgrade prompt). Returns the tenant for convenience.
 */
export async function requireFeature(feature: string): Promise<ActiveTenant> {
  const tenant = await requireTenant()
  if (!(await tenantHasFeature(tenant.tenantId, feature))) redirect("/billing")
  return tenant
}
