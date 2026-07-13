"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export type OnboardingState = { error: string } | undefined

/**
 * Provision the caller's restaurant: creates tenant + settings + default branch
 * + owner membership atomically via the `provision_tenant` SECURITY DEFINER
 * function (authenticated users can't INSERT tenants directly under RLS).
 * Idempotent — a user who already has a tenant is sent straight to the dashboard.
 */
export async function provisionTenant(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const name = String(formData.get("restaurantName") ?? "").trim()
  const currency = String(formData.get("currency") ?? "USD").trim()
  const timezone = String(formData.get("timezone") ?? "UTC").trim()
  const serviceCharge = Number(formData.get("serviceCharge") ?? 0)

  if (!name) return { error: "Restaurant name is required." }
  if (Number.isNaN(serviceCharge) || serviceCharge < 0 || serviceCharge > 100)
    return { error: "Service charge must be between 0 and 100." }

  // Optional tax-rules step — variable list of {name, rate, inclusive} (rule #2).
  let taxRules: { name: string; rate: number; inclusive: boolean }[] = []
  try {
    const parsed = JSON.parse(String(formData.get("taxRules") ?? "[]"))
    if (Array.isArray(parsed)) {
      taxRules = parsed
        .map((r) => ({
          name: String(r?.name ?? "").trim(),
          rate: Number(r?.rate),
          inclusive: Boolean(r?.inclusive),
        }))
        .filter((r) => r.name)
    }
  } catch {
    return { error: "Invalid tax rules." }
  }
  for (const r of taxRules) {
    if (!Number.isFinite(r.rate) || r.rate < 0 || r.rate > 100)
      return { error: `Tax rate for "${r.name}" must be between 0 and 100.` }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { error } = await supabase.rpc("provision_tenant", {
    _name: name,
    _currency: currency,
    _timezone: timezone,
  })
  if (error) return { error: error.message }

  // provision_tenant creates tenant_settings; layer the tax/service choices on
  // top (owner RLS now applies — the membership exists).
  if (taxRules.length > 0 || serviceCharge > 0) {
    const { data: t } = await supabase
      .from("user_tenants")
      .select("tenant_id")
      .eq("user_id", user.id)
      .eq("role", "owner")
      .order("tenant_id")
      .limit(1)
      .maybeSingle()
    if (t?.tenant_id) {
      await supabase
        .from("tenant_settings")
        .update({ tax_rules: taxRules, service_charge: serviceCharge })
        .eq("tenant_id", t.tenant_id)
    }
  }

  revalidatePath("/", "layout")
  redirect("/")
}
