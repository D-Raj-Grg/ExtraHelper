import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { BillingManager } from "@/components/billing-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function BillingPage() {
  const tenant = await requireRole("owner")
  const supabase = await createClient()

  const [{ data: sub }, { data: plans }, { data: invoices }] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("status, current_period_end, plans(code, name, price_cents)")
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle(),
    supabase
      .from("plans")
      .select("code, name, price_cents, features, limits")
      .eq("is_active", true)
      .order("price_cents"),
    supabase
      .from("platform_invoices")
      .select("id, amount_cents, status, issued_at")
      .eq("tenant_id", tenant.tenantId)
      .order("issued_at", { ascending: false })
      .limit(12),
  ])

  return (
    <PageShell>
      <PageHeader
        title={<>{tenant.name} · Billing</>}
        description="Your subscription, plan features, and invoices."
      />
      <BillingManager
        currency={tenant.currency}
        timezone={tenant.timezone}
        subscription={sub as never}
        plans={(plans ?? []) as never}
        invoices={invoices ?? []}
      />
    </PageShell>
  )
}
