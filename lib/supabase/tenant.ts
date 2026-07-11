import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"

export const ACTIVE_TENANT_COOKIE = "active-tenant"

export type ActiveTenant = {
  tenantId: string
  role: string
  name: string
  slug: string
  currency: string
  timezone: string
}

export type TenantMembership = {
  tenantId: string
  role: string
  name: string
  slug: string
}

type Row = {
  role: string
  tenant_id: string
  tenants:
    | { name: string; slug: string; tenant_settings: unknown }
    | { name: string; slug: string; tenant_settings: unknown }[]
    | null
}

async function fetchMemberships(): Promise<Row[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from("user_tenants")
    .select("role, tenant_id, tenants(name, slug, tenant_settings(currency, timezone))")
    .eq("user_id", user.id)
    .order("tenant_id", { ascending: true }) // stable ordering for "first"

  return (data ?? []) as Row[]
}

function tenantOf(row: Row) {
  return Array.isArray(row.tenants) ? row.tenants[0] : row.tenants
}

/**
 * The current user's active tenant — the one selected via the `active-tenant`
 * cookie (tenant switcher), else their first membership. Null if not onboarded.
 * RLS scopes the query to the caller's own memberships.
 */
export async function getActiveTenant(): Promise<ActiveTenant | null> {
  const rows = await fetchMemberships()
  if (rows.length === 0) return null

  const store = await cookies()
  const wanted = store.get(ACTIVE_TENANT_COOKIE)?.value
  const row = rows.find((r) => r.tenant_id === wanted) ?? rows[0]

  const tenant = tenantOf(row)
  const settingsRaw = (tenant as { tenant_settings?: unknown })?.tenant_settings
  const settings = (Array.isArray(settingsRaw) ? settingsRaw[0] : settingsRaw) as
    | { currency?: string; timezone?: string }
    | undefined

  return {
    tenantId: row.tenant_id,
    role: row.role,
    name: tenant?.name ?? "",
    slug: tenant?.slug ?? "",
    currency: settings?.currency ?? "USD",
    timezone: settings?.timezone ?? "UTC",
  }
}

/** All tenants the current user belongs to — for the tenant switcher. */
export async function getTenantMemberships(): Promise<TenantMembership[]> {
  const rows = await fetchMemberships()
  return rows.map((r) => {
    const tenant = tenantOf(r)
    return {
      tenantId: r.tenant_id,
      role: r.role,
      name: tenant?.name ?? "",
      slug: tenant?.slug ?? "",
    }
  })
}
