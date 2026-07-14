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

  const restaurantName = String(formData.get("restaurantName") ?? "").trim()
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

  const blockNegativeStock = formData.get("blockNegativeStock") === "on"

  const supabaseEarly = await createClient()
  // Preserve any keys we don't edit here (e.g. logo_url set by uploadTenantLogo)
  // instead of clobbering the whole receipt_template JSON.
  const { data: existing } = await supabaseEarly
    .from("tenant_settings")
    .select("receipt_template")
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  const receiptTemplate = {
    ...((existing?.receipt_template as Record<string, unknown>) ?? {}),
    header: String(formData.get("receiptHeader") ?? "").trim(),
    footer: String(formData.get("receiptFooter") ?? "").trim(),
    terms: String(formData.get("receiptTerms") ?? "").trim(),
  }

  // Pluggable payment gateway (rule #6). Only registered keys are accepted.
  const GATEWAYS = ["sandbox", "manual"]
  const paymentGateway = String(formData.get("paymentGateway") ?? "sandbox").trim()
  if (!GATEWAYS.includes(paymentGateway)) return { error: "Unknown payment gateway." }

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
      block_negative_stock: blockNegativeStock,
      payment_gateway: paymentGateway,
    })
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }

  // Restaurant name lives on `tenants`, not tenant_settings. Only owners may
  // change it (tenants_owner_update RLS); a manager's attempt is a no-op.
  if (restaurantName && restaurantName !== tenant.name) {
    const { error: nameErr } = await supabase
      .from("tenants")
      .update({ name: restaurantName })
      .eq("id", tenant.tenantId)
    if (nameErr) return { error: nameErr.message }
  }

  revalidatePath("/settings")
  // Sidebar + tenant switcher read the name from the layout — refresh it.
  revalidatePath("/", "layout")
  return { ok: true }
}

/** Upload a tenant logo/brand image → receipt_template.logo_url (Storage). */
export async function uploadTenantLogo(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const tenant = await requireRole("owner", "manager")
  const file = formData.get("logo")
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image file." }
  if (file.size > 3 * 1024 * 1024) return { error: "Logo must be under 3 MB." }

  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "")
  const path = `${tenant.tenantId}/logo.${ext}`
  const supabase = await createClient()
  const { error: upErr } = await supabase.storage
    .from("menu-images")
    .upload(path, file, { upsert: true, contentType: file.type || undefined })
  if (upErr) return { error: upErr.message }
  const { data: pub } = supabase.storage.from("menu-images").getPublicUrl(path)
  const url = `${pub.publicUrl}?v=${Date.now()}`

  // Merge into the existing receipt_template JSON without clobbering other keys.
  const { data: current } = await supabase
    .from("tenant_settings")
    .select("receipt_template")
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  const tmpl = { ...((current?.receipt_template as Record<string, unknown>) ?? {}), logo_url: url }
  const { error } = await supabase
    .from("tenant_settings")
    .update({ receipt_template: tmpl })
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/settings")
  return { ok: true }
}

// --- Branch management (multi-branch) --------------------------------------

export async function createBranch(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const tenant = await requireRole("owner", "manager")
  const name = String(formData.get("name") ?? "").trim()
  const address = String(formData.get("address") ?? "").trim() || null
  if (!name) return { error: "Branch name is required." }
  const supabase = await createClient()
  const { error } = await supabase
    .from("branches")
    .insert({ tenant_id: tenant.tenantId, name, address })
  if (error) return { error: error.message }
  revalidatePath("/settings")
  return { ok: true }
}

export async function updateBranch(
  branchId: string,
  fields: { name?: string; address?: string | null },
): Promise<SettingsState> {
  const tenant = await requireRole("owner", "manager")
  const patch: Record<string, unknown> = {}
  if (fields.name !== undefined) {
    const n = fields.name.trim()
    if (!n) return { error: "Branch name is required." }
    patch.name = n
  }
  if (fields.address !== undefined) patch.address = fields.address?.trim() || null
  if (Object.keys(patch).length === 0) return { ok: true }
  const supabase = await createClient()
  const { error } = await supabase
    .from("branches")
    .update(patch)
    .eq("id", branchId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/settings")
  return { ok: true }
}

export async function deleteBranch(branchId: string): Promise<SettingsState> {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()
  // Never delete the default branch (it anchors existing data).
  const { data: b } = await supabase
    .from("branches")
    .select("is_default")
    .eq("id", branchId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  if (b?.is_default) return { error: "Can't delete the default branch." }
  const { error } = await supabase
    .from("branches")
    .delete()
    .eq("id", branchId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/settings")
  return { ok: true }
}
