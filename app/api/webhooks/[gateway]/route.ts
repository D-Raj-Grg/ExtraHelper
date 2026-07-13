import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Payment-gateway webhook reconciliation. A gateway calls this to confirm a
 * previously-'pending' payment resolved to succeeded/failed. This is the ONLY
 * place the service-role key is used — a trusted server context, never exposed
 * to any client. Guarded by a shared secret (WEBHOOK_SECRET header).
 *
 * Body: { reference: string, status: "succeeded" | "failed" }
 * The `reference` matches payments.idempotency_key set at charge time.
 *
 * Env required: SUPABASE_SERVICE_ROLE_KEY, WEBHOOK_SECRET (and NEXT_PUBLIC_SUPABASE_URL).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ gateway: string }> },
) {
  const { gateway } = await params

  const secret = process.env.WEBHOOK_SECRET
  const provided = req.headers.get("x-webhook-secret")
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !url) {
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 })
  }

  let body: { reference?: string; status?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const reference = String(body.reference ?? "").trim()
  const status = String(body.status ?? "").trim()
  if (!reference || (status !== "succeeded" && status !== "failed")) {
    return NextResponse.json({ error: "reference and status required" }, { status: 400 })
  }

  // Service-role client — bypasses RLS. Used only here, server-side.
  const admin = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: payment, error: findErr } = await admin
    .from("payments")
    .select("id, bill_id, tenant_id, status")
    .eq("idempotency_key", reference)
    .maybeSingle()
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })
  if (!payment) return NextResponse.json({ error: "unknown reference" }, { status: 404 })

  // Idempotent: already reconciled → ack without re-applying.
  if (payment.status === "completed" || payment.status === "failed") {
    return NextResponse.json({ ok: true, alreadyReconciled: true, gateway })
  }

  const newStatus = status === "succeeded" ? "completed" : "failed"
  const { error: upErr } = await admin
    .from("payments")
    .update({ status: newStatus })
    .eq("id", payment.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // On success, roll the bill up to paid + close the order + free the table.
  if (newStatus === "completed" && payment.bill_id) {
    const { data: bill } = await admin
      .from("bills")
      .select("id, total_cents, table_id")
      .eq("id", payment.bill_id)
      .maybeSingle()
    if (bill) {
      const { data: paidRows } = await admin
        .from("payments")
        .select("amount_cents")
        .eq("bill_id", bill.id)
        .eq("status", "completed")
      const paid = (paidRows ?? []).reduce((s, p) => s + p.amount_cents, 0)
      const billStatus = paid >= bill.total_cents ? "paid" : paid > 0 ? "partial" : "open"
      await admin.from("bills").update({ status: billStatus }).eq("id", bill.id)
      if (billStatus === "paid") {
        await admin.from("orders").update({ status: "closed" }).eq("bill_id", bill.id)
        if (bill.table_id)
          await admin.from("restaurant_tables").update({ state: "free" }).eq("id", bill.table_id)
      }
    }
  }

  return NextResponse.json({ ok: true, gateway, status: newStatus })
}
