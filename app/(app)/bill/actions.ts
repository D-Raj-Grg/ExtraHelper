"use server"

import { randomUUID } from "crypto"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { getGateway } from "@/lib/integrations"

export type BillState = { error: string } | { ok: true } | undefined

/** Generate (or reuse) the bill for an order, then open it. */
/**
 * Open (or reuse) the bill for a fired order and go to it. Returns an error
 * instead of the old silent redirect back to the order: bouncing the cashier
 * to the page they were already on read as the button being broken.
 */
export async function generateBill(orderId: string): Promise<{ error: string } | undefined> {
  await requirePermission("checkout.view")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_bill_for_order", {
    _order_id: orderId,
  })
  if (error) return { error: error.message }
  if (!data) return { error: "Couldn't open a bill for this order." }
  // Throws NEXT_REDIRECT — must stay outside any try/catch.
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

/**
 * Take the staff discount back off the bill.
 *
 * Removes the typed discount or the comp — never a coupon, which the guest
 * redeemed and `remove_bill_discount` deliberately leaves alone.
 */
export async function removeDiscount(billId: string): Promise<BillState> {
  await requirePermission("order.discount")
  const supabase = await createClient()
  const { error } = await supabase.rpc("remove_bill_discount", {
    _bill_id: billId,
  })
  if (error) return { error: error.message }

  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/** Take the discount back off one line. Other lines keep theirs. */
export async function removeItemDiscount(orderItemId: string, billId: string): Promise<BillState> {
  await requirePermission("order.discount")
  const supabase = await createClient()
  const { error } = await supabase.rpc("remove_item_discount", {
    _order_item_id: orderItemId,
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
  const { error } = await supabase.rpc("apply_coupon", {
    _bill_id: billId,
    _code: code,
  })
  if (error) return { error: error.message }
  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/** Add a named extra charge (delivery, packing, corkage…) to an open bill. */
export async function addCharge(
  billId: string,
  label: string,
  amountCents: number,
): Promise<BillState> {
  await requirePermission("order.discount")
  if (!label.trim()) return { error: "Name the charge." }
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    return { error: "Charge must be a positive amount." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("add_bill_charge", {
    _bill_id: billId,
    _label: label,
    _amount_cents: amountCents,
  })
  if (error) return { error: error.message }
  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/** Remove an extra charge (bill id only for the revalidate). */
export async function removeCharge(chargeId: string, billId: string): Promise<BillState> {
  await requirePermission("order.discount")
  const supabase = await createClient()
  const { error } = await supabase.rpc("remove_bill_charge", {
    _charge_id: chargeId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/**
 * Tip, round-off and the invoice remark — one call, because the checkout
 * screen edits them together and each write recomputes the bill.
 */
export async function setBillExtras(
  billId: string,
  tipCents: number,
  roundingCents: number,
  note: string,
): Promise<BillState> {
  await requirePermission("payment.take")
  if (!Number.isInteger(tipCents) || tipCents < 0) return { error: "Tip can't be negative." }
  if (!Number.isInteger(roundingCents) || Math.abs(roundingCents) > 99)
    return { error: "Round off must be under one currency unit." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_bill_extras", {
    _bill_id: billId,
    _tip_cents: tipCents,
    _rounding_cents: roundingCents,
    _note: note || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}

/** Comp the whole bill — a full-gross discount, manager-gated, reason required. */
export async function setComplimentary(billId: string, reason: string): Promise<BillState> {
  await requirePermission("order.discount")
  if (!reason.trim()) return { error: "A complimentary bill needs a reason." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_bill_complimentary", {
    _bill_id: billId,
    _reason: reason,
  })
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
export async function payByCard(billId: string, amountCents: number): Promise<BillState> {
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
