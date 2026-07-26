"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ACTIVE_TENANT_COOKIE } from "@/lib/supabase/tenant"

export type OnboardingState = { error: string } | undefined
export type JoinState =
  | { error: string }
  | { ok: true; name: string; status: string; already: boolean }
  | undefined

/** Redeem a join code → creates a pending membership (owner approves). */
export async function redeemCode(
  _prev: JoinState,
  formData: FormData,
): Promise<JoinState> {
  const code = String(formData.get("code") ?? "").trim()
  if (!code) return { error: "Enter a join code." }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("redeem_join_code", { _code: code })
  if (error || !data) return { error: error?.message ?? "Could not redeem that code." }
  const r = data as unknown as { name: string; status: string; already: boolean }
  revalidatePath("/onboarding")
  revalidatePath("/", "layout")
  return { ok: true, name: r.name, status: r.status, already: r.already }
}

/** Attach any pending email invites for the signed-in user. */
export async function claimInvites(): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("claim_invites")
  if (error) return { error: error.message }
  revalidatePath("/onboarding")
  return { ok: true }
}

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
  // "Add restaurant" flow → force a brand-new tenant even if the user already
  // owns one (first-run onboarding leaves this false and stays idempotent).
  const forceNew = String(formData.get("add") ?? "") === "1"

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

  const { data: newTenant, error } = await supabase.rpc("provision_tenant", {
    _name: name,
    _currency: currency,
    _timezone: timezone,
    _force_new: forceNew,
  })
  if (error || !newTenant) return { error: error?.message ?? "Could not create the restaurant." }
  const tenantId = newTenant as string

  // provision_tenant creates tenant_settings; layer the tax/service choices on
  // the just-created tenant (owner RLS now applies — the membership exists).
  if (taxRules.length > 0 || serviceCharge > 0) {
    await supabase
      .from("tenant_settings")
      .update({ tax_rules: taxRules, service_charge: serviceCharge })
      .eq("tenant_id", tenantId)
  }

  // Make the new restaurant the active one so the dashboard opens on it.
  const store = await cookies()
  store.set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })

  revalidatePath("/", "layout")
  redirect("/")
}
