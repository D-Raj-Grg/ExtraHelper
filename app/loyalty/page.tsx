import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requireRole, tenantHasFeature } from "@/lib/supabase/guards"
import { LoyaltyManager } from "@/components/loyalty-manager"

export const dynamic = "force-dynamic"

export default async function LoyaltyPage() {
  const tenant = await requireRole("owner", "manager")
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
    <div className="mx-auto w-full max-w-4xl p-6 md:p-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{tenant.name} · Loyalty &amp; CRM</h1>
        <p className="text-sm text-muted-foreground">
          Customer points, tiers, and post-visit feedback.
        </p>
      </div>
      <LoyaltyManager
        customers={(customers ?? []) as never}
        feedback={(feedback ?? []) as never}
        timezone={tenant.timezone}
      />
    </div>
  )
}
