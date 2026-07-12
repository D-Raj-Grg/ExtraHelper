import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requirePermission, tenantHasFeature } from "@/lib/supabase/guards"
import { LoyaltyManager } from "@/components/loyalty-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function LoyaltyPage() {
  const tenant = await requirePermission("loyalty.view")
  if (!(await tenantHasFeature(tenant.tenantId, "loyalty"))) redirect("/billing")
  const supabase = await createClient()

  const [{ data: customers }, { data: feedback }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, phone, loyalty_accounts(points_balance, tier)")
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("feedback")
      .select("id, rating, comment, created_at, customers(name)")
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
  ])

  return (
    <PageShell>
      <PageHeader
        title={<>{tenant.name} · Loyalty &amp; CRM</>}
        description="Customer points, tiers, and post-visit feedback."
      />
      <LoyaltyManager
        customers={(customers ?? []) as never}
        feedback={(feedback ?? []) as never}
        timezone={tenant.timezone}
      />
    </PageShell>
  )
}
