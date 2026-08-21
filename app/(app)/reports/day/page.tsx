import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { PageShell, PageHeader } from "@/components/page-header"
import { DayClose } from "@/components/reports/day-close"
import { DayPicker } from "@/components/reports/day-picker"
import { ReportEmpty } from "@/components/reports/report-section"
import type { DayReport } from "@/components/reports/day-report"
import { businessDay } from "@/lib/format"
import { isYmd } from "@/lib/report-range"

export const dynamic = "force-dynamic"

/**
 * The day-close (Z) sheet: one business day, on its own route.
 *
 * Not a fifth tab on /reports — that page resolves a *range* and hands every
 * tab the same ctx, so the range pills and the vs-prev comparison would render
 * meaningless controls over a single day. This is the URL a manager bookmarks
 * and a cashier opens at close.
 */
export default async function DayClosePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const sp = await searchParams
  const tenant = await requirePermission("reports.view")

  // The tenant's current business day, which is not necessarily today's date —
  // a 4am cutoff means 01:30 is still yesterday. Same rule the RPC applies.
  const today = businessDay(new Date(), tenant.timezone, tenant.dayCutoffMinutes)
  const date = isYmd(sp.date) && sp.date <= today ? sp.date : today

  const supabase = await createClient()
  const { data } = await supabase.rpc("daily_report", {
    _tenant: tenant.tenantId,
    _day: date,
  })
  const report = data as unknown as DayReport | null

  return (
    <PageShell>
      <PageHeader
        title="Day close"
        description={`${tenant.name}'s trading day, ready to sign off. Print it, export it, or file the PDF.`}
      />

      <DayPicker date={date} today={today} />

      {report ? (
        <DayClose r={report} />
      ) : (
        <ReportEmpty>
          This report needs the Reports permission. Ask an owner or manager to grant it.
        </ReportEmpty>
      )}
    </PageShell>
  )
}
