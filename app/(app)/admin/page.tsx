import { createClient } from "@/lib/supabase/server"
import { requirePlatformAdmin } from "@/lib/supabase/guards"
import { money } from "@/lib/format"
import { TenantStatusButton } from "@/components/admin-tenant-actions"
import { AdminPlanSelect } from "@/components/admin-plan-select"
import { runDunning, startImpersonation } from "@/app/(app)/admin/actions"
import { PageShell, PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"

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
  subscriptions: { status: string; plans: { code: string; name: string } | null }[]
}

export default async function AdminPage() {
  await requirePlatformAdmin()
  const supabase = await createClient()

  const [{ data: tenants }, { data: plans }, { data: invoices }] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, name, slug, status, created_at, subscriptions(status, plans(code, name))")
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
        actions={
          <form action={runDunning}>
            <Button type="submit" variant="outline" size="sm">
              Run dunning now
            </Button>
          </form>
        }
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
        <Table className="w-full text-sm">
          <TableHeader className="bg-muted/50 text-left">
            <TableRow>
              <TableHead className="px-4 py-3 font-medium">Restaurant</TableHead>
              <TableHead className="px-4 py-3 font-medium">Status</TableHead>
              <TableHead className="px-4 py-3 font-medium">Plan</TableHead>
              <TableHead className="px-4 py-3 font-medium text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No tenants yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((t) => {
                const plan = t.subscriptions?.[0]?.plans ?? null
                const subStatus = t.subscriptions?.[0]?.status ?? null
                return (
                  <TableRow key={t.id} className="border-t">
                    <TableCell className="px-4 py-3">
                      <span className="font-medium">{t.name}</span>
                      <span className="block text-xs text-muted-foreground">{t.slug}</span>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status] ?? STATUS_STYLES.cancelled}`}>
                        {t.status}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <AdminPlanSelect tenantId={t.id} currentCode={plan?.code ?? null} plans={planOpts} />
                      {subStatus === "past_due" ? (
                        <span className="mt-1 inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                          past due
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <form action={startImpersonation.bind(null, t.id)}>
                          <Button type="submit" variant="outline" size="sm">
                            View as
                          </Button>
                        </form>
                        <TenantStatusButton tenantId={t.id} status={t.status} />
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </PageShell>
  )
}
