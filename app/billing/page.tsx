import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { BillingManager } from "@/components/billing-manager"

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
    <div className="mx-auto w-full max-w-4xl p-6 md:p-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{tenant.name} · Billing</h1>
        <p className="text-sm text-muted-foreground">
          Your subscription, plan features, and invoices.
        </p>
      </div>
      <BillingManager
        currency={tenant.currency}
        timezone={tenant.timezone}
        subscription={sub as never}
        plans={(plans ?? []) as never}
        invoices={invoices ?? []}
      />
    </div>
  )
}
