import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { PageShell, PageHeader } from "@/components/page-header"
import { CustomersTab } from "@/components/reports/customers-tab"
import { InventoryTab } from "@/components/reports/inventory-tab"
import { ReportFilters } from "@/components/reports/report-filters"
import { ReportSkeleton } from "@/components/reports/report-skeleton"
import { SalesTab } from "@/components/reports/sales-tab"
import { StaffTab } from "@/components/reports/staff-tab"
import {
  REPORT_TABS,
  WINDOWS,
  resolveRange,
  type ReportTab,
  type WindowKey,
} from "@/lib/report-range"

export const dynamic = "force-dynamic"

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; from?: string; to?: string; tab?: string }>
}) {
  const sp = await searchParams
  const window: WindowKey = WINDOWS.find((x) => x.key === sp.window)?.key ?? "today"
  const tab: ReportTab = REPORT_TABS.find((t) => t.key === sp.tab)?.key ?? "sales"

  const tenant = await requirePermission("reports.view")
  const supabase = await createClient()
  const cur = tenant.currency
  const tz = tenant.timezone

  const { from, to, prevFrom, prevTo, custom } = resolveRange(window, sp.from, sp.to, new Date(), tz)
  const ctx = { supabase, tenantId: tenant.tenantId, F: from.toISOString(), T: to.toISOString(), cur }

  return (
    <PageShell>
      <PageHeader
        title="Reports"
        description={`Paid-bill analytics for ${tenant.name}, in its own timezone. Export CSV or print.`}
      />

      <ReportFilters tab={tab} window={window} custom={custom} from={sp.from} to={sp.to} />

      {/* Keyed so switching tab or range shows the skeleton rather than stale numbers. */}
      <Suspense key={`${tab}-${ctx.F}-${ctx.T}`} fallback={<ReportSkeleton />}>
        {tab === "sales" ? (
          <SalesTab {...ctx} PF={prevFrom.toISOString()} PT={prevTo.toISOString()} tz={tz} />
        ) : null}
        {tab === "inventory" ? <InventoryTab {...ctx} /> : null}
        {tab === "staff" ? <StaffTab {...ctx} /> : null}
        {tab === "customers" ? <CustomersTab {...ctx} /> : null}
      </Suspense>
    </PageShell>
  )
}
