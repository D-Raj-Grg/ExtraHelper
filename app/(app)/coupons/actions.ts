"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireTenant } from "@/lib/supabase/guards"
import { zonedTimeToUtc } from "@/lib/format"
import type { OrderType } from "@/lib/order-constants"
import { COUPON_ORDER_TYPES, type CouponRow, type CouponType } from "@/lib/coupon-constants"

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
