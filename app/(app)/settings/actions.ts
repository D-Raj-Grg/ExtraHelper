"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"

export type SettingsState = { error: string } | { ok: true } | undefined

/**
 * Update the active tenant's settings. Owner/manager only (guard + RLS).
 * Region-configurable per rule #2 — currency/tax/charges are never hardcoded.
 */
export async function updateSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const tenant = await requireRole("owner", "manager")

  const currency = String(formData.get("currency") ?? "").trim() || "USD"
  const timezone = String(formData.get("timezone") ?? "").trim() || "UTC"
  const serviceCharge = Number(formData.get("serviceCharge") ?? 0)
  const packagingFee = Number(formData.get("packagingFee") ?? 0)

  if (Number.isNaN(serviceCharge) || serviceCharge < 0 || serviceCharge > 100)
    return { error: "Service charge must be between 0 and 100." }
  if (Number.isNaN(packagingFee) || packagingFee < 0)
    return { error: "Packaging fee must be zero or positive." }

  // Tax rules — variable list of {name, rate, inclusive}. Region-configurable
  // per rule #2 (no hardcoded country tax).
  let taxRules: { name: string; rate: number; inclusive: boolean }[]
  try {
    const parsed = JSON.parse(String(formData.get("taxRules") ?? "[]"))
    if (!Array.isArray(parsed)) throw new Error("not an array")
    taxRules = parsed.map((r) => ({
      name: String(r?.name ?? "").trim(),
      rate: Number(r?.rate),
      inclusive: Boolean(r?.inclusive),
    }))
  } catch {
    return { error: "Invalid tax rules." }
  }
  for (const r of taxRules) {
    if (!r.name) return { error: "Each tax rule needs a name." }
    if (!Number.isFinite(r.rate) || r.rate < 0 || r.rate > 100)
      return { error: `Tax rate for "${r.name}" must be between 0 and 100.` }
  }

  const receiptTemplate = {
    header: String(formData.get("receiptHeader") ?? "").trim(),
    footer: String(formData.get("receiptFooter") ?? "").trim(),
    terms: String(formData.get("receiptTerms") ?? "").trim(),
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("tenant_settings")
    .update({
      currency,
      timezone,
      service_charge: serviceCharge,
      packaging_fee: packagingFee,
      tax_rules: taxRules,
      receipt_template: receiptTemplate,
    })
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }

  revalidatePath("/settings")
  return { ok: true }
}
