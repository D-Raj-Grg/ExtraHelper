import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { ReceiptView } from "@/components/receipt-view"
import type { ReceiptTemplate } from "@/lib/print/branding"

export const dynamic = "force-dynamic"

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ billId: string }>
}) {
  const { billId } = await params
  const tenant = await requireRole("owner", "manager", "cashier")
  const supabase = await createClient()

  const [
    { data: bill },
    { data: items },
    { data: payments },
    { data: settings },
    { data: billPrinter },
    { data: orders },
  ] = await Promise.all([
    supabase
      .from("bills")
      .select(
        "id, status, subtotal_cents, tax_cents, service_charge_cents, discount_cents, total_cents, created_at, restaurant_tables(label)",
      )
      .eq("id", billId)
      .maybeSingle(),
    supabase
      .from("bill_items")
      .select("id, description, qty, unit_price_cents, total_cents")
      .eq("bill_id", billId),
    supabase
      .from("payments")
      .select("id, method, amount_cents")
      .eq("bill_id", billId)
      .eq("status", "completed"),
    supabase
      .from("tenant_settings")
      .select("receipt_template")
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle(),
    // The paper this tenant's bill printer is actually loaded with, so the
    // browser fallback prints the same slip the ESC/POS queue would. Assigning
    // the `bill` document is what makes a printer a receipt printer since
    // 20260731160100_printing_v2.sql replaced `printers.role`.
    supabase
      .from("printer_documents")
      .select("printers!inner(paper_width, is_active)")
      .eq("tenant_id", tenant.tenantId)
      .eq("doc", "bill")
      .eq("printers.is_active", true)
      .limit(1)
      .maybeSingle(),
    // Same source the printed slip uses (lib/print/job-render.ts): earliest
    // order, because a merged bill can carry several and they may have
    // different waiters.
    supabase
      .from("orders")
      .select("waiter_id, customers(name)")
      .eq("bill_id", billId)
      .eq("tenant_id", tenant.tenantId)
      .order("created_at"),
  ])

  if (!bill) notFound()

  const first = (orders ?? [])[0] as unknown as
    | { waiter_id: string | null; customers: { name: string | null } | null }
    | undefined

  let servedBy: string | null = null
  if (first?.waiter_id) {
    const { data: p } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", first.waiter_id)
      .maybeSingle()
    servedBy = (p?.full_name as string | null) ?? (p?.username as string | null) ?? null
  }

  const template = (settings?.receipt_template ?? {}) as ReceiptTemplate

  // No printer configured is the common case on a fresh tenant; 80mm is the
  // same fallback lib/print/render.ts uses.
  const printer = (billPrinter as unknown as { printers?: { paper_width: number } } | null)
    ?.printers
  const paperWidthMm = printer?.paper_width ?? 80

  // print:min-h-0 — a viewport-height wrapper stretches the printed document and
  // feeds a blank page after the slip.
  return (
    <div className="flex min-h-svh justify-center bg-muted/30 p-6 print:min-h-0 print:bg-white print:p-0">
      <ReceiptView
        paperWidthMm={paperWidthMm}
        tenantName={tenant.name}
        currency={tenant.currency}
        timezone={tenant.timezone}
        bill={bill as never}
        items={items ?? []}
        payments={payments ?? []}
        footer={template.footer}
        terms={template.terms}
        logoUrl={template.logo_url}
        qrUrl={template.qr_url}
        qrCaption={template.qr_caption}
        customerName={first?.customers?.name ?? null}
        servedBy={servedBy}
      />
    </div>
  )
}
