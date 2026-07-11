"use server"

import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { getNotificationProvider } from "@/lib/integrations"

export type ReceiptState = { error: string } | { ok: true } | undefined

/**
 * Send a digital receipt via the tenant's notification adapter (rule #6).
 * Dev default is the console provider; swap per tenant for real email/SMS.
 */
export async function emailReceipt(
  billId: string,
  to: string,
): Promise<ReceiptState> {
  const tenant = await requireRole("owner", "manager", "cashier")
  if (!to.trim() || !to.includes("@")) return { error: "Enter a valid email." }

  const supabase = await createClient()
  const { data: bill } = await supabase
    .from("bills")
    .select("total_cents, status")
    .eq("id", billId)
    .maybeSingle()
  if (!bill) return { error: "Bill not found." }

  const provider = getNotificationProvider(null) // per-tenant config resolves later
  const { status } = await provider.send({
    tenantId: tenant.tenantId,
    channel: "email",
    to,
    subject: `Receipt from ${tenant.name}`,
    body: `Your receipt total is ${(bill.total_cents / 100).toFixed(2)} ${tenant.currency}. View: /receipt/${billId}`,
    metadata: { billId },
  })
  if (status === "failed") return { error: "Failed to send receipt." }
  return { ok: true }
}
