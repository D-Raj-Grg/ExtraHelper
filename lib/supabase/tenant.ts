import { createClient } from "@/lib/supabase/server"

export type ActiveTenant = {
  tenantId: string
  role: string
  name: string
  slug: string
  currency: string
  timezone: string
}

/**
 * The current user's active tenant (first membership) joined with tenant +
 * settings, or null if the user hasn't onboarded yet. RLS scopes the query to
 * the caller's own memberships.
 */
export async function getActiveTenant(): Promise<ActiveTenant | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from("user_tenants")
    .select(
      "role, tenant_id, tenants(name, slug, tenant_settings(currency, timezone))",
    )
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle()

  if (!data) return null

  // Supabase returns embedded relations as objects (or arrays); normalize.
  const tenant = Array.isArray(data.tenants) ? data.tenants[0] : data.tenants
  const settings = Array.isArray(tenant?.tenant_settings)
    ? tenant?.tenant_settings[0]
    : tenant?.tenant_settings

  return {
    tenantId: data.tenant_id as string,
    role: data.role as string,
    name: (tenant?.name as string) ?? "",
    slug: (tenant?.slug as string) ?? "",
    currency: (settings?.currency as string) ?? "USD",
    timezone: (settings?.timezone as string) ?? "UTC",
  }
}
