"use server"

import { randomUUID } from "crypto"
import { createClient } from "@/lib/supabase/server"
import { getGateway } from "@/lib/integrations"

export type PayState =
  | { error: string }
  | { ok: true; status: string; paidCents: number; totalCents: number }

type Quote = {
  bill_id: string
  total: number
  paid: number
  due: number
  currency: string
  gateway: string
  tenant_id: string
}

/**
 * What an order comes to right now, from the server — the figure the gateway
 * will be charged. The guest pages show this after placement instead of their
 * own estimate, so the button never names one number and charges another.
 */
export async function quoteOrder(orderId: string): Promise<{ due: number; total: number } | null> {
  if (!orderId) return null
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("public_bill_quote", { _order_id: orderId })
  if (error || !data) return null
  const q = data as unknown as Quote
  return { due: q.due, total: q.total }
}

/**
 * Customer-facing payment for an order (QR pay-at-table / online prepay). Runs
 * as the anon role: quotes the outstanding balance via a token/order-scoped
 * SECURITY DEFINER RPC, charges the tenant's gateway (sandbox by default), then
 * records the payment atomically (public_pay_order only ever credits the bill
 * and clamps overpay). A real gateway drops in behind the same interface.
 */
export async function payForOrder(orderId: string): Promise<PayState> {
  if (!orderId) return { error: "Missing order." }
  const supabase = await createClient()

  const { data: quoteRaw, error: qErr } = await supabase.rpc("public_bill_quote", {
    _order_id: orderId,
  })
  if (qErr || !quoteRaw) return { error: qErr?.message ?? "Could not load the bill." }
  const quote = quoteRaw as unknown as Quote

  if (quote.due <= 0) {
    return { ok: true, status: "paid", paidCents: quote.paid, totalCents: quote.total }
  }

  const reference = randomUUID()
  const gateway = getGateway(quote.gateway)
  const result = await gateway.createPayment({
    tenantId: quote.tenant_id,
    amountCents: quote.due,
    currency: quote.currency,
    idempotencyKey: reference,
  })
  if (result.status === "failed") return { error: "Payment failed. Please try again." }
  // 'pending' → persist a pending payment keyed by the gateway reference so the
  // webhook (/api/webhooks/[gateway]) can reconcile it to completed later. For
  // sandbox this is 'succeeded' and settles immediately below.
  if (result.status !== "succeeded") {
    await supabase.rpc("public_record_pending", {
      _order_id: orderId,
      _reference: result.reference,
    })
    return { ok: true, status: "pending", paidCents: quote.paid, totalCents: quote.total }
  }

  const { data: payRaw, error: pErr } = await supabase.rpc("public_pay_order", {
    _order_id: orderId,
    _reference: result.reference,
  })
  if (pErr || !payRaw) return { error: pErr?.message ?? "Could not record the payment." }
  const pay = payRaw as unknown as { status: string; paid: number; total: number }
  return { ok: true, status: pay.status, paidCents: pay.paid, totalCents: pay.total }
}
