"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { writeAudit } from "@/lib/supabase/audit"
import { RESET_DOMAIN_KEYS, RESET_EVERYTHING } from "@/lib/danger-constants"
import type { ReceiptTemplate } from "@/lib/print/branding"

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
  // Unchecked boxes are absent from the body, so this reads as "off" only when
  // the operator actually cleared it — which is what makes waiter confirmation
  // an opt-in and auto-fire the default.
  const qrAutoFire = formData.get("qrAutoFire") === "on"

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
      block_negative_stock: blockNegativeStock,
      qr_auto_fire: qrAutoFire,
      payment_gateway: paymentGateway,
    })
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }

  // receipt_template is patched, not replaced: the logo and QR uploads write
  // their own keys into the same blob from their own cards, and a save bar that
  // wrote the whole object would drop whichever upload landed first.
  const { error: tmplErr } = await supabase.rpc("merge_receipt_template", {
    _tenant: tenant.tenantId,
    _patch: {
      header: String(formData.get("receiptHeader") ?? "").trim(),
      footer: String(formData.get("receiptFooter") ?? "").trim(),
      terms: String(formData.get("receiptTerms") ?? "").trim(),
      qr_caption: String(formData.get("qrCaption") ?? "").trim(),
    },
  })
  if (tmplErr) return { error: tmplErr.message }

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

/**
 * Upload the logo or the payment QR.
 *
 * Two things land per upload: the original image, to Storage, for every screen
 * that shows a picture; and the 1-bit bitmaps the client baked from it, into
 * `receipt_template.print_assets`, for the thermal printers. Baking happens in
 * the browser because it is the only place with a canvas — the Android app and
 * the headless print agent fetch finished bytes and write them to a socket, so
 * an asset that has to be drawn at print time never reaches paper from either.
 */
export async function uploadBrandImage(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const tenant = await requireRole("owner", "manager")

  const kind = String(formData.get("kind") ?? "")
  if (kind !== "logo" && kind !== "qr") return { error: "Unknown image kind." }
  const noun = kind === "logo" ? "Logo" : "QR code"

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image file." }
  if (file.size > 3 * 1024 * 1024) return { error: `${noun} must be under 3 MB.` }

  const variants = parseBakedImage(formData.get("variants"))
  if ("error" in variants) return variants

  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "")
  const path = `${tenant.tenantId}/${kind === "logo" ? "logo" : "receipt-qr"}.${ext}`
  const supabase = await createClient()
  const { error: upErr } = await supabase.storage
    .from("menu-images")
    .upload(path, file, { upsert: true, contentType: file.type || undefined })
  if (upErr) return { error: upErr.message }
  const { data: pub } = supabase.storage.from("menu-images").getPublicUrl(path)
  const url = `${pub.publicUrl}?v=${Date.now()}`

  const { data: current } = await supabase
    .from("tenant_settings")
    .select("receipt_template")
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  const assets = ((current?.receipt_template as ReceiptTemplate | null)?.print_assets ??
    {}) as NonNullable<ReceiptTemplate["print_assets"]>

  const { error } = await supabase.rpc("merge_receipt_template", {
    _tenant: tenant.tenantId,
    _patch: {
      [kind === "logo" ? "logo_url" : "qr_url"]: url,
      // Replaced wholesale, never merged: a half-old set of widths would print
      // last month's logo on the 58mm roll and this month's on the 80mm one.
      print_assets: { ...assets, [kind]: variants.variants },
    },
  })
  if (error) return { error: error.message }
  revalidatePath("/settings")
  return { ok: true }
}

/** Take the logo or QR off the receipt — both the picture and the baked bytes. */
export async function removeBrandImage(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const tenant = await requireRole("owner", "manager")
  const kind = String(formData.get("kind") ?? "")
  if (kind !== "logo" && kind !== "qr") return { error: "Unknown image kind." }

  const supabase = await createClient()
  const { data: current } = await supabase
    .from("tenant_settings")
    .select("receipt_template")
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()
  const template = (current?.receipt_template ?? {}) as ReceiptTemplate
  const assets = { ...(template.print_assets ?? {}) } as Record<string, unknown>
  delete assets[kind]

  // Drop the picture too. The bucket is public, so leaving the object behind
  // means the "removed" logo is still served to anyone holding its URL.
  const oldUrl = kind === "logo" ? template.logo_url : template.qr_url
  const path = oldUrl?.split("?")[0].split("/menu-images/")[1]
  if (path?.startsWith(`${tenant.tenantId}/`)) {
    await supabase.storage.from("menu-images").remove([path])
  }

  const { error } = await supabase.rpc("merge_receipt_template", {
    _tenant: tenant.tenantId,
    // json null deletes the key outright — see the migration.
    _patch: { [kind === "logo" ? "logo_url" : "qr_url"]: null, print_assets: assets },
  })
  if (error) return { error: error.message }
  revalidatePath("/settings")
  return { ok: true }
}

/**
 * The baked bitmaps arrive from the browser, so nothing about them is trusted.
 * The bytes themselves are only ever wrapped in a `GS v 0` header this server
 * builds from `w`/`h`, so the risk is not injected commands but a mismatched
 * length: a row count that disagrees with the payload makes the printer read
 * the next ticket's bytes as image data and spit out a metre of noise.
 */
function parseBakedImage(
  raw: FormDataEntryValue | null,
): { variants: Record<string, { w: number; h: number; data: string }> } | { error: string } {
  const WIDTHS = new Set(["384", "416", "576"])
  const BUDGET = 200 * 1024

  let parsed: unknown
  try {
    parsed = JSON.parse(String(raw ?? ""))
  } catch {
    return { error: "That image could not be prepared for printing. Try another file." }
  }
  if (!parsed || typeof parsed !== "object") return { error: "Prepared image data is missing." }

  const out: Record<string, { w: number; h: number; data: string }> = {}
  let total = 0
  for (const [width, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!WIDTHS.has(width)) return { error: "Prepared image data is for an unknown paper width." }
    const v = value as { w?: unknown; h?: unknown; data?: unknown }
    const w = Number(v.w)
    const h = Number(v.h)
    const data = typeof v.data === "string" ? v.data : ""
    if (w !== Number(width) || !Number.isInteger(h) || h < 1 || h > 2000)
      return { error: "Prepared image data has the wrong dimensions." }
    // base64 → bytes, and the packed rows must be exactly ceil(w/8) * h.
    const bytes = Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0)
    if (bytes !== Math.ceil(w / 8) * h)
      return { error: "Prepared image data is incomplete. Try uploading again." }
    total += data.length
    out[width] = { w, h, data }
  }

  if (!Object.keys(out).length) return { error: "Prepared image data is missing." }
  if (total > BUDGET)
    return { error: "That image is too detailed to print. Try a smaller or simpler one." }
  return { variants: out }
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

// --- Dangerous Area (owner-only) -------------------------------------------

/**
 * Selectively wipe operational data (rule #5: audited). The RPC re-checks
 * owner + does the tenant-scoped deletes; this guard is the UX floor only.
 */
export async function resetRestaurant(domains: string[]): Promise<SettingsState> {
  const tenant = await requireRole("owner")
  const everything = domains.includes(RESET_EVERYTHING)
  const clean = everything
    ? [RESET_EVERYTHING]
    : domains.filter((d) => RESET_DOMAIN_KEYS.includes(d))
  if (clean.length === 0) return { error: "Pick at least one thing to reset." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("reset_tenant", {
    _tenant: tenant.tenantId,
    _domains: clean,
  })
  if (error) return { error: error.message }

  await writeAudit({
    tenantId: tenant.tenantId,
    action: "tenant_reset",
    entityType: "tenant",
    entityId: tenant.tenantId,
    metadata: { domains: clean },
  })
  revalidatePath("/settings")
  revalidatePath("/", "layout")
  return { ok: true }
}

/** Hand ownership to an active member; caller demotes to manager. */
export async function transferOwnership(userId: string): Promise<SettingsState> {
  const tenant = await requireRole("owner")
  if (!userId) return { error: "Choose a member to transfer to." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("transfer_tenant_ownership", {
    _tenant: tenant.tenantId,
    _to_user: userId,
  })
  if (error) return { error: error.message }

  await writeAudit({
    tenantId: tenant.tenantId,
    action: "ownership_transfer",
    entityType: "user",
    entityId: userId,
    metadata: { to: userId },
  })
  revalidatePath("/settings")
  revalidatePath("/", "layout")
  return { ok: true }
}

/** Schedule the restaurant for deletion after a 7-day grace period. */
export async function requestDeleteRestaurant(): Promise<SettingsState> {
  const tenant = await requireRole("owner")
  const supabase = await createClient()
  const { error } = await supabase.rpc("request_tenant_deletion", {
    _tenant: tenant.tenantId,
  })
  if (error) return { error: error.message }

  await writeAudit({
    tenantId: tenant.tenantId,
    action: "tenant_delete_requested",
    entityType: "tenant",
    entityId: tenant.tenantId,
  })
  revalidatePath("/settings")
  revalidatePath("/", "layout")
  return { ok: true }
}

/** Cancel a pending deletion during the grace window. */
export async function cancelDeleteRestaurant(): Promise<SettingsState> {
  const tenant = await requireRole("owner")
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancel_tenant_deletion", {
    _tenant: tenant.tenantId,
  })
  if (error) return { error: error.message }

  await writeAudit({
    tenantId: tenant.tenantId,
    action: "tenant_delete_cancelled",
    entityType: "tenant",
    entityId: tenant.tenantId,
  })
  revalidatePath("/settings")
  revalidatePath("/", "layout")
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
