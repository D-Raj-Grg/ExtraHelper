"use client"

import { createContext, useContext } from "react"
import type { ActiveTenant } from "@/lib/supabase/tenant"

const TenantContext = createContext<ActiveTenant | null>(null)

/**
 * Makes the active tenant available to Client Components (currency formatting,
 * role-aware UI, tenant name in headers). Hydrated from a Server Component that
 * already resolved the tenant via `getActiveTenant()` — no client fetch.
 */
export function TenantProvider({
  tenant,
  children,
}: {
  tenant: ActiveTenant
  children: React.ReactNode
}) {
  return <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>
}

/** Active tenant, or null outside a provider (e.g. pre-onboarding). */
export function useTenant(): ActiveTenant | null {
  return useContext(TenantContext)
}

/** Active tenant, throwing if used outside a provider — for tenant-scoped UI. */
export function useRequiredTenant(): ActiveTenant {
  const tenant = useContext(TenantContext)
  if (!tenant) throw new Error("useRequiredTenant must be used within a TenantProvider")
  return tenant
}
