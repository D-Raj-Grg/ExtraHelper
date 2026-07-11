"use server"

import { randomUUID } from "crypto"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { getGateway } from "@/lib/integrations"

export type BillState = { error: string } | { ok: true } | undefined

const BILL_ROLES = ["owner", "manager", "cashier"] as const

/** Generate (or reuse) the bill for an order, then open it. */
export async function generateBill(orderId: string): Promise<void> {
  await requireRole(...BILL_ROLES)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_bill_for_order", {
    _order_id: orderId,
  })
  if (error || !data) redirect(`/pos/${orderId}`)
  redirect(`/bill/${data}`)
}

/** Apply a bill-level discount (owner/manager only; trusted recompute + audit). */
export async function applyDiscount(
  billId: string,
  type: "percent" | "flat",
  value: number,
  reason: string,
): Promise<BillState> {
  await requireRole("owner", "manager")
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

/** Void a bill line (owner/manager; trusted recompute + audit). */
export async function voidLine(
  orderItemId: string,
  billId: string,
  reason: string,
): Promise<BillState> {
  await requireRole("owner", "manager")
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
  await requireRole("owner", "manager")
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
  const tenant = await requireRole(...BILL_ROLES)
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    return { error: "Amount must be a positive number." }

  const idempotencyKey = randomUUID()
  // Per-tenant gateway selection is a future setting; sandbox for now.
  const gateway = getGateway("sandbox")
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

/** Record a payment (trusted SQL flips bill → partial/paid, closes order). */
export async function takePayment(
  billId: string,
  method: "cash" | "card" | "online" | "wallet" | "points",
  amountCents: number,
): Promise<BillState> {
  await requireRole(...BILL_ROLES)
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    return { error: "Amount must be a positive number." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("record_payment", {
    _bill_id: billId,
    _method: method,
    _amount_cents: amountCents,
    _idempotency_key: randomUUID(),
  })
  if (error) return { error: error.message }

  revalidatePath(`/bill/${billId}`)
  return { ok: true }
}
