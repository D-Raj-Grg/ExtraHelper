import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { SessionCard } from "@/components/cash/session-card"
import { ShiftReports } from "@/components/cash/shift-reports"
import type { ClosedSession } from "@/components/cash/types"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function CashPage() {
  const tenant = await requirePermission("cash.view")
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: open }, { data: closed }] = await Promise.all([
    user
      ? supabase
          .from("cash_sessions")
          .select("id, opening_float_cents, opened_at")
          .eq("tenant_id", tenant.tenantId)
          .eq("cashier_id", user.id)
          .eq("status", "open")
          .order("opened_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Recent closed sessions = shift reports, tenant-wide (RLS scopes the tenant).
    supabase
      .from("cash_sessions")
      .select(
        "id, cashier_id, opening_float_cents, expected_cents, counted_cents, variance_cents, opened_at, closed_at",
      )
      .eq("tenant_id", tenant.tenantId)
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(10),
  ])

  // cash_sessions.cashier_id points at auth.users, not profiles, so PostgREST
  // can't infer the join — resolve the display names in one follow-up query.
  const rows = closed ?? []
  const cashierIds = [...new Set(rows.map((s) => s.cashier_id).filter(Boolean))]
  const { data: profiles } = cashierIds.length
    ? await supabase.from("profiles").select("id, full_name, username").in("id", cashierIds)
    : { data: [] }
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id, p.full_name || (p.username ? `@${p.username}` : null)]),
  )

  const sessions: ClosedSession[] = rows.map((s) => ({
    id: s.id,
    opening_float_cents: s.opening_float_cents,
    expected_cents: s.expected_cents,
    counted_cents: s.counted_cents,
    variance_cents: s.variance_cents,
    opened_at: s.opened_at,
    closed_at: s.closed_at,
    cashier: nameById.get(s.cashier_id) ?? null,
  }))

  return (
    <PageShell>
      <PageHeader
        title="Cash Drawer"
        description={`Open a session, then reconcile counted against expected at close. Times in ${tenant.name}'s timezone.`}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <SessionCard
          currency={tenant.currency}
          timezone={tenant.timezone}
          openSessionRow={open ?? null}
        />
        <ShiftReports sessions={sessions} currency={tenant.currency} timezone={tenant.timezone} />
      </div>
    </PageShell>
  )
}
