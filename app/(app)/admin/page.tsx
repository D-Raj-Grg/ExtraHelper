import { createClient } from "@/lib/supabase/server"
import { requirePlatformAdmin } from "@/lib/supabase/guards"
import { money } from "@/lib/format"
import { TenantStatusButton } from "@/components/admin-tenant-actions"
import { AdminPlanSelect } from "@/components/admin-plan-select"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

const STATUS_STYLES: Record<string, string> = {
  trial: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  active: "bg-green-500/10 text-green-600 dark:text-green-400",
  suspended: "bg-red-500/10 text-red-600 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
}

type TenantRow = {
  id: string
  name: string
  slug: string
  status: string
  created_at: string
  subscriptions: { plans: { code: string; name: string } | null }[]
}

export default async function AdminPage() {
  await requirePlatformAdmin()
  const supabase = await createClient()

  const [{ data: tenants }, { data: plans }, { data: invoices }] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, name, slug, status, created_at, subscriptions(plans(code, name))")
      .order("created_at", { ascending: false }),
    supabase.from("plans").select("code, name").eq("is_active", true).order("price_cents"),
    supabase.from("platform_invoices").select("amount_cents").eq("status", "paid"),
  ])

  const rows = (tenants ?? []) as unknown as TenantRow[]
  const planOpts = plans ?? []
  const mrr = (invoices ?? []).reduce((s, i) => s + i.amount_cents, 0)
  const byStatus = rows.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1
    return acc
  }, {})

  const metrics = [
    { label: "Tenants", value: String(rows.length) },
    { label: "Active", value: String(byStatus.active ?? 0) },
    { label: "Trial", value: String(byStatus.trial ?? 0) },
    { label: "Suspended", value: String(byStatus.suspended ?? 0) },
    { label: "Collected", value: money(mrr, "USD") },
  ]

  return (
    <PageShell>
      <PageHeader
        title="Super Admin"
        description="Platform tenants, plans, and usage."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className="text-xl font-bold">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Restaurant</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No tenants yet.
                </td>
              </tr>
            ) : (
              rows.map((t) => {
                const plan = t.subscriptions?.[0]?.plans ?? null
                return (
                  <tr key={t.id} className="border-t">
                    <td className="px-4 py-3">
                      <span className="font-medium">{t.name}</span>
                      <span className="block text-xs text-muted-foreground">{t.slug}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status] ?? STATUS_STYLES.cancelled}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <AdminPlanSelect tenantId={t.id} currentCode={plan?.code ?? null} plans={planOpts} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <TenantStatusButton tenantId={t.id} status={t.status} />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
