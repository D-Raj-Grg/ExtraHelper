import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { ReceiptView } from "@/components/receipt-view"

export const dynamic = "force-dynamic"

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ billId: string }>
}) {
  const { billId } = await params
  const tenant = await requireRole("owner", "manager", "cashier")
  const supabase = await createClient()

  const [{ data: bill }, { data: items }, { data: payments }, { data: settings }] =
    await Promise.all([
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
    ])

  if (!bill) notFound()

  const template = (settings?.receipt_template ?? {}) as {
    footer?: string
    terms?: string
    logo_url?: string
  }

  return (
    <div className="flex min-h-svh justify-center bg-muted/30 p-6 print:bg-white print:p-0">
      <ReceiptView
        tenantName={tenant.name}
        currency={tenant.currency}
        timezone={tenant.timezone}
        bill={bill as never}
        items={items ?? []}
        payments={payments ?? []}
        footer={template.footer}
        terms={template.terms}
      />
    </div>
  )
}
