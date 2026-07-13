"use server"

import { randomUUID } from "crypto"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { getGateway } from "@/lib/integrations"

export type BillState = { error: string } | { ok: true } | undefined

/** Generate (or reuse) the bill for an order, then open it. */
export async function generateBill(orderId: string): Promise<void> {
  await requirePermission("checkout.view")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_bill_for_order", {
    _order_id: orderId,
  })
  if (error || !data) redirect(`/pos/${orderId}`)
  redirect(`/bill/${data}`)
}

/** Merge another (fired) order onto this bill — combined/multi-order tab. */
export async function addOrderToBill(billId: string, orderId: string): Promise<BillState> {
  await requirePermission("checkout.view")
  const supabase = await createClient()
  const { error } = await supabase.rpc("add_order_to_bill", {
    _bill_id: billId,
    _order_id: orderId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/** Apply a bill-level discount (owner/manager only; trusted recompute + audit). */
export async function applyDiscount(
  billId: string,
  type: "percent" | "flat",
  value: number,
  reason: string,
): Promise<BillState> {
  await requirePermission("order.discount")
  if (!Number.isFinite(value) || value <= 0)
    return { error: "Discount must be a positive number." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("apply_bill_discount", {
    _bill_id: billId,
    _type: type,
    _value: value,
    _reason: reason || null,
  })
  if (error) return { error: error.message }

  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/** Apply an item-level discount (owner/manager; trusted recompute + audit). */
export async function applyItemDiscount(
  orderItemId: string,
  billId: string,
  type: "percent" | "flat",
  value: number,
  reason: string,
): Promise<BillState> {
  await requirePermission("order.discount")
  if (!Number.isFinite(value) || value <= 0)
    return { error: "Discount must be a positive number." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("apply_item_discount", {
    _order_item_id: orderItemId,
    _type: type,
    _value: value,
    _reason: reason || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/** Apply a coupon code to the bill (cashier-usable; validated server-side). */
export async function applyCoupon(billId: string, code: string): Promise<BillState> {
  await requirePermission("payment.take")
  if (!code.trim()) return { error: "Enter a coupon code." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("apply_coupon", { _bill_id: billId, _code: code })
  if (error) return { error: error.message }
  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/** Void a bill line (owner/manager; trusted recompute + audit). */
export async function voidLine(
  orderItemId: string,
  billId: string,
  reason: string,
): Promise<BillState> {
  await requirePermission("order.void")
  if (!reason.trim()) return { error: "Void reason is required." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("void_order_item", {
    _order_item_id: orderItemId,
    _reason: reason,
  })
  if (error) return { error: error.message }

  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/** Refund against a paid bill (owner/manager; audited). */
export async function refundBill(
  billId: string,
  amountCents: number,
  reason: string,
): Promise<BillState> {
  await requirePermission("payment.refund")
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    return { error: "Refund amount must be a positive number." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("refund_payment", {
    _bill_id: billId,
    _amount_cents: amountCents,
    _reason: reason || null,
  })
  if (error) return { error: error.message }

  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/**
 * Charge a card online via the tenant's payment gateway (sandbox by default),
 * then record the payment. Demonstrates the pluggable gateway adapter (rule #6).
 */
export async function payByCard(
  billId: string,
  amountCents: number,
): Promise<BillState> {
  const tenant = await requirePermission("payment.take")
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    return { error: "Amount must be a positive number." }

  const idempotencyKey = randomUUID()
  // Per-tenant gateway selection (rule #6) — configured in settings.
  const gateway = getGateway(tenant.paymentGateway)
  const result = await gateway.createPayment({
    tenantId: tenant.tenantId,
    amountCents,
    currency: tenant.currency,
    idempotencyKey,
  })
  if (result.status !== "succeeded") return { error: "Card charge failed." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("record_payment", {
    _bill_id: billId,
    _method: "online",
    _amount_cents: amountCents,
    _idempotency_key: result.reference,
  })
  if (error) return { error: error.message }

  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/** Attach (or create) a customer on the bill's order so points can be redeemed. */
export async function attachCustomer(
  billId: string,
  name: string,
  phone: string,
): Promise<BillState> {
  await requirePermission("payment.take")
  if (!name.trim() && !phone.trim()) return { error: "Enter a name or phone." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("attach_bill_customer", {
    _bill_id: billId,
    _name: name || null,
    _phone: phone || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/** Redeem loyalty points → burn + record a 'points' payment (trusted, atomic). */
export async function redeemPoints(billId: string, points: number): Promise<BillState> {
  await requirePermission("payment.take")
  if (!Number.isInteger(points) || points <= 0)
    return { error: "Points must be a positive whole number." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("redeem_points_for_bill", {
    _bill_id: billId,
    _points: points,
    _idempotency_key: randomUUID(),
  })
  if (error) return { error: error.message }
  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/** Record a payment (trusted SQL flips bill → partial/paid, closes order). */
export async function takePayment(
  billId: string,
  method: "cash" | "card" | "online" | "wallet" | "points",
  amountCents: number,
  idempotencyKey?: string,
): Promise<BillState> {
  await requirePermission("payment.take")
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    return { error: "Amount must be a positive number." }

  const supabase = await createClient()
  // Client-supplied key when present (offline queue replay → dedup via
  // record_payment's on-conflict); otherwise a fresh server key.
  const { error } = await supabase.rpc("record_payment", {
    _bill_id: billId,
    _method: method,
    _amount_cents: amountCents,
    _idempotency_key: idempotencyKey || randomUUID(),
  })
  if (error) return { error: error.message }

  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}
