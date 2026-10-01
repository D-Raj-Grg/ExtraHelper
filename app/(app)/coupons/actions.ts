"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireTenant } from "@/lib/supabase/guards"
import { zonedTimeToUtc } from "@/lib/format"
import type { OrderType } from "@/lib/order-constants"
import { parsePlacement } from "@/lib/flyer"
import { COUPON_ORDER_TYPES, type CouponRow, type CouponType } from "@/lib/coupon-constants"
import type { Json } from "@/lib/supabase/database.types"

export type CouponState = { error: string } | { ok: true; id: string } | undefined

// Permission checks live in the RPCs (coupons.manage); these actions only
// shape the form into the call and surface the database's answer.

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** Start of `day` in the tenant's zone, as an ISO instant. */
function dayStart(day: string, timeZone: string): string | null {
  if (!YMD.test(day)) return null
  const d = zonedTimeToUtc(`${day}T00:00:00`, timeZone)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * "Valid through 30 Sep" means the whole of the 30th, so the stored bound is
 * the exclusive start of the 1st — computed on the calendar, then zoned.
 */
function dayEnd(day: string, timeZone: string): string | null {
  if (!YMD.test(day)) return null
  const [y, m, d] = day.split("-").map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  const p = (n: number) => String(n).padStart(2, "0")
  return dayStart(`${next.getUTCFullYear()}-${p(next.getUTCMonth() + 1)}-${p(next.getUTCDate())}`, timeZone)
}

function optionalInt(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim()
  if (s === "") return null
  const n = Number(s)
  return Number.isInteger(n) ? n : NaN
}

type UpsertArgs = {
  _tenant: string
  _id: string
  _code: string
  _name: string
  _type: CouponType
  _value: number
  _is_active: boolean
  _valid_from: string
  _valid_to: string
  _usage_limit: number
  _min_subtotal_cents: number
  _once_per_customer: boolean
  _order_types: OrderType[]
}

async function upsert(args: UpsertArgs): Promise<CouponState> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("upsert_coupon", args)
  if (error) return { error: error.message }
  revalidatePath("/coupons")
  return { ok: true, id: data as string }
}

/** Create or edit a campaign from the editor sheet. */
export async function saveCoupon(_prev: CouponState, formData: FormData): Promise<CouponState> {
  const tenant = await requireTenant()

  const id = String(formData.get("id") ?? "") || null
  const code = String(formData.get("code") ?? "").trim().toUpperCase()
  const name = String(formData.get("name") ?? "").trim()
  const type = String(formData.get("type") ?? "percent") === "flat" ? "flat" : "percent"
  const value = Number(String(formData.get("value") ?? "").trim())
  const active = formData.get("active") === "on"
  const validFromDay = String(formData.get("valid_from") ?? "").trim()
  const validToDay = String(formData.get("valid_to") ?? "").trim()
  const usageLimit = optionalInt(formData.get("usage_limit"))
  const minOrder = String(formData.get("min_subtotal") ?? "").trim()
  const minCents = minOrder === "" ? 0 : Math.round(Number(minOrder) * 100)
  const oncePerCustomer = formData.get("once_per_customer") === "on"
  const orderTypes = formData
    .getAll("order_types")
    .map(String)
    .filter((t): t is OrderType => (COUPON_ORDER_TYPES as readonly string[]).includes(t))

  if (!Number.isFinite(value) || value <= 0) return { error: "Enter a discount above zero." }
  if (type === "percent" && value > 100) return { error: "A discount can't be more than 100%." }
  if (Number.isNaN(usageLimit)) return { error: "Usage limit must be a whole number." }
  if (usageLimit !== null && usageLimit < 1) return { error: "Usage limit must be at least 1." }
  if (!Number.isFinite(minCents) || minCents < 0) return { error: "Minimum order can't be negative." }
  if (code && !/^[A-Z0-9-]{4,24}$/.test(code)) return { error: "Codes are 4 to 24 letters, digits or dashes." }

  const validFrom = validFromDay ? dayStart(validFromDay, tenant.timezone) : null
  const validTo = validToDay ? dayEnd(validToDay, tenant.timezone) : null
  if (validFromDay && !validFrom) return { error: "Pick a real start date." }
  if (validToDay && !validTo) return { error: "Pick a real end date." }
  if (validFrom && validTo && validTo <= validFrom) return { error: "The coupon must end after it starts." }

  return upsert({
    _tenant: tenant.tenantId,
    // The RPC treats null as "create"; the generated type says string.
    _id: id as unknown as string,
    _code: code,
    _name: name,
    _type: type,
    _value: value,
    _is_active: active,
    _valid_from: validFrom as unknown as string,
    _valid_to: validTo as unknown as string,
    _usage_limit: usageLimit as unknown as number,
    _min_subtotal_cents: minCents,
    _once_per_customer: oncePerCustomer,
    // Every type or none is "any"; the RPC stores null for that.
    _order_types: (orderTypes.length === 0 || orderTypes.length === COUPON_ORDER_TYPES.length
      ? null
      : orderTypes) as unknown as OrderType[],
  })
}

/** Pause or resume without opening the editor: the row's own values, one flag flipped. */
export async function setCouponActive(coupon: CouponRow, active: boolean): Promise<CouponState> {
  const tenant = await requireTenant()
  return upsert({
    _tenant: tenant.tenantId,
    _id: coupon.id,
    _code: coupon.code,
    _name: coupon.name ?? "",
    _type: coupon.type,
    _value: coupon.value,
    _is_active: active,
    _valid_from: coupon.valid_from as unknown as string,
    _valid_to: coupon.valid_to as unknown as string,
    _usage_limit: coupon.usage_limit as unknown as number,
    _min_subtotal_cents: coupon.min_subtotal_cents,
    _once_per_customer: coupon.once_per_customer,
    _order_types: coupon.order_types as unknown as OrderType[],
  })
}

/** Only a coupon nobody has used can go; the RPC says so when it refuses. */
export async function deleteCoupon(id: string): Promise<CouponState> {
  await requireTenant()
  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_coupon", { _id: id })
  if (error) return { error: error.message }
  revalidatePath("/coupons")
  return { ok: true, id }
}

export type BatchState = { error: string } | { ok: true; id: string }

/**
 * A print run: `count` unique single-use codes (`PREFIX-XXXXXX`) of the same
 * deal. The RPC checks `coupons.manage` and builds the codes; this shapes the
 * form into the call.
 */
export async function createCouponBatch(input: {
  name: string
  count: number
  prefix: string
  type: CouponType
  value: number
  validFrom: string
  validTo: string
  dineInOnly: boolean
}): Promise<BatchState> {
  const tenant = await requireTenant()

  const name = input.name.trim()
  const prefix = input.prefix.trim().toUpperCase()
  if (!name) return { error: "Give the batch a name." }
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 1000) {
    return { error: "A batch is 1 to 1000 codes." }
  }
  if (!/^[A-Z0-9]{2,8}$/.test(prefix)) return { error: "The prefix is 2 to 8 letters or digits." }
  if (!Number.isFinite(input.value) || input.value <= 0) return { error: "Enter a discount above zero." }
  if (input.type === "percent" && input.value > 100) return { error: "A discount can't be more than 100%." }

  const validFrom = input.validFrom ? dayStart(input.validFrom, tenant.timezone) : null
  const validTo = input.validTo ? dayEnd(input.validTo, tenant.timezone) : null
  if (input.validFrom && !validFrom) return { error: "Pick a real start date." }
  if (input.validTo && !validTo) return { error: "Pick a real end date." }
  if (validFrom && validTo && validTo <= validFrom) return { error: "The coupon must end after it starts." }
  if (validTo && new Date(validTo).getTime() <= Date.now()) return { error: "That end date has already passed." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_coupon_batch", {
    _tenant: tenant.tenantId,
    _name: name,
    _count: input.count,
    _prefix: prefix,
    _type: input.type,
    _value: input.value,
    _valid_from: validFrom as unknown as string,
    _valid_to: validTo as unknown as string,
    _min_subtotal_cents: 0,
    _once_per_customer: false,
    // Null is "any"; the flyer says dine-in only when the box is ticked.
    _order_types: (input.dineInOnly ? ["dine_in"] : null) as unknown as OrderType[],
  })
  if (error) return { error: error.message }
  revalidatePath("/coupons/flyers")
  return { ok: true, id: data as string }
}

/**
 * Rename a run or move its dates. Codes, prefix and discount are printed on
 * paper, so they are not editable; the RPC carries the new window onto every code.
 */
export async function updateCouponBatch(input: {
  batchId: string
  name: string
  validFrom: string
  validTo: string
}): Promise<BatchState> {
  const tenant = await requireTenant()
  const name = input.name.trim()
  if (!name) return { error: "Give the run a name." }
  const validFrom = input.validFrom ? dayStart(input.validFrom, tenant.timezone) : null
  const validTo = input.validTo ? dayEnd(input.validTo, tenant.timezone) : null
  if (input.validFrom && !validFrom) return { error: "Pick a real start date." }
  if (input.validTo && !validTo) return { error: "Pick a real end date." }
  if (validFrom && validTo && validTo <= validFrom) return { error: "The coupon must end after it starts." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_coupon_batch", {
    _batch: input.batchId,
    _name: name,
    _valid_from: validFrom as unknown as string,
    _valid_to: validTo as unknown as string,
  })
  if (error) return { error: error.message }
  revalidatePath("/coupons/flyers")
  return { ok: true, id: input.batchId }
}

/** The codes of one run, for the editor preview, the PDF and the CSV. */
export async function getBatchCodes(
  batchId: string,
): Promise<{ error: string } | { codes: { code: string; redeemed: boolean; shared: boolean }[] }> {
  await requireTenant()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("get_batch_codes", { _batch: batchId })
  if (error) return { error: error.message }
  const rows = (data ?? []) as { code: string; redeemed: boolean; shared: boolean }[]
  return { codes: rows.map((r) => ({ code: r.code, redeemed: r.redeemed, shared: r.shared })) }
}

/** Pause or resume a whole run, e.g. after a stack of flyers goes missing. */
export async function setBatchActive(batchId: string, active: boolean): Promise<CouponState> {
  await requireTenant()
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_batch_active", { _batch: batchId, _active: active })
  if (error) return { error: error.message }
  revalidatePath("/coupons/flyers")
  return { ok: true, id: batchId }
}

/**
 * Note that a flyer was shared or handed over, so the owner knows which codes
 * are still free to give out. It never affects whether the code redeems.
 */
export async function markCouponShared(batchId: string, code: string, shared = true): Promise<CouponState> {
  await requireTenant()
  const supabase = await createClient()
  const { error } = await supabase.rpc("mark_coupon_shared", { _batch: batchId, _code: code, _shared: shared })
  if (error) return { error: error.message }
  return { ok: true, id: batchId }
}

export type DesignState = { error: string } | { ok: true; id: string }

const TEMPLATE_BUCKET = "flyer-templates"
const TEMPLATE_MAX_BYTES = 5 * 1024 * 1024
const TEMPLATE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" }

/**
 * Save a flyer design: where the code and QR sit, how the QR is built, and the
 * template image when one was picked this time. A new image gets a fresh storage
 * name and the old one is removed only once the row points at the new one, so a
 * failure part-way leaves the previous design working. Pointing `batch` at it
 * makes the run open with this design.
 */
export async function saveFlyerDesign(formData: FormData): Promise<DesignState> {
  const tenant = await requireTenant()
  const supabase = await createClient()

  const id = String(formData.get("id") ?? "") || null
  const name = String(formData.get("name") ?? "").trim()
  const batch = String(formData.get("batch") ?? "") || null
  const mode = String(formData.get("mode") ?? "") === "code" ? "code" : "url"
  const linkBase = String(formData.get("linkBase") ?? "").trim()
  const width = Number(formData.get("width"))
  const height = Number(formData.get("height"))
  const placement = parsePlacement(String(formData.get("placement") ?? ""))
  const file = formData.get("template")

  if (!name) return { error: "Give the design a name." }
  if (name.length > 80) return { error: "Keep the name under 80 characters." }
  if (!placement) return { error: "The placement is missing. Move a box and try again." }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { error: "The template size is missing. Upload the template again." }
  }

  let uploaded: string | null = null
  if (file instanceof File && file.size > 0) {
    const ext = TEMPLATE_EXT[file.type]
    if (!ext) return { error: "Use a JPEG or PNG image." }
    if (file.size > TEMPLATE_MAX_BYTES) return { error: "The template must be under 5 MB." }
    uploaded = `${tenant.tenantId}/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage.from(TEMPLATE_BUCKET).upload(uploaded, file, { contentType: file.type })
    if (upErr) return { error: `The template didn't upload: ${upErr.message}` }
  } else if (!id) {
    return { error: "Upload the template first." }
  }

  let previous: string | null = null
  if (id && uploaded) {
    const { data } = await supabase.rpc("list_flyer_designs", { _tenant: tenant.tenantId })
    previous = ((data ?? []) as { id: string; image_path: string }[]).find((d) => d.id === id)?.image_path ?? null
  }

  const { data, error } = await supabase.rpc("save_flyer_design", {
    _tenant: tenant.tenantId,
    _id: id as unknown as string,
    _name: name,
    _image_path: uploaded as unknown as string,
    _width: width,
    _height: height,
    _placement: placement as unknown as Json,
    _mode: mode,
    _link_base: (mode === "url" ? linkBase : "") as unknown as string,
    _batch: batch as unknown as string,
  })
  if (error) {
    if (uploaded) await supabase.storage.from(TEMPLATE_BUCKET).remove([uploaded])
    return { error: error.message }
  }
  if (previous) await supabase.storage.from(TEMPLATE_BUCKET).remove([previous])
  revalidatePath("/coupons/flyers")
  return { ok: true, id: data as string }
}

/** Delete a design and its picture. Runs that used it stay, and open without a design. */
export async function deleteFlyerDesign(id: string): Promise<DesignState> {
  await requireTenant()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("delete_flyer_design", { _id: id })
  if (error) return { error: error.message }
  if (data) await supabase.storage.from(TEMPLATE_BUCKET).remove([data as string])
  revalidatePath("/coupons/flyers")
  return { ok: true, id }
}
