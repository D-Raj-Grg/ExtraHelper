import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requirePermission, tenantHasFeature } from "@/lib/supabase/guards"
import { getMyPermissions } from "@/lib/supabase/permissions"
import { indexCredit } from "@/lib/customer-credit"
import { LoyaltyManager } from "@/components/loyalty-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function LoyaltyPage() {
  const tenant = await requirePermission("loyalty.view")
  if (!(await tenantHasFeature(tenant.tenantId, "loyalty"))) redirect("/billing")
  const supabase = await createClient()

  const [{ data: customers }, { data: feedback }, permissions, { data: credit }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, phone, email, loyalty_accounts(points_balance, tier)")
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("feedback")
      .select("id, rating, comment, created_at, customers(name)")
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
    getMyPermissions(tenant.tenantId),
    // Who owes what. Not capped like the customer list: a debtor outside the
    // newest 50 must still count towards the total shown at the top.
    supabase.rpc("customer_credit_summary", { _tenant: tenant.tenantId }),
  ])

  const { byCustomer: creditByCustomer, totalCents: totalOutstandingCents } = indexCredit(credit)

  // Debtors who fell off the newest-50 page still need a row to be chased from.
  const listed = new Set((customers ?? []).map((c) => c.id))
  const missing = [...creditByCustomer.keys()].filter((id) => !listed.has(id))
  const { data: extra } = missing.length
    ? await supabase
        .from("customers")
        .select("id, name, phone, email, loyalty_accounts(points_balance, tier)")
        .eq("tenant_id", tenant.tenantId)
        .in("id", missing)
    : { data: [] }

  const rows = [...(customers ?? []), ...(extra ?? [])].map((c) => ({
    ...c,
    ...(creditByCustomer.get(c.id) ?? { outstanding_cents: 0, unpaid_bills: 0 }),
  }))

  return (
    <PageShell>
      <PageHeader
        title="Loyalty & CRM"
        description={`Customer points, tiers, credit owed, and post-visit feedback for ${tenant.name}.`}
      />
      <LoyaltyManager
        customers={rows as never}
        feedback={(feedback ?? []) as never}
        timezone={tenant.timezone}
        currency={tenant.currency}
        totalOutstandingCents={totalOutstandingCents}
        debtors={creditByCustomer.size}
        canManage={permissions.includes("loyalty.edit")}
        canCollect={permissions.includes("payment.take")}
      />
    </PageShell>
  )
}
