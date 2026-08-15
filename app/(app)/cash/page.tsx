import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { SessionCard } from "@/components/cash/session-card"
import { ShiftReports } from "@/components/cash/shift-reports"
import type { CashMovement, ClosedSession } from "@/components/cash/types"
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

  // Movements on the open session, plus whether this user may sign them off.
  // cash.approve is deliberately NOT held by the cashier role — a cashier
  // approving their own payout would make the review step decorative.
  const [{ data: canApproveData }, { data: movementRows }] = await Promise.all([
    supabase.rpc("has_permission", { _tenant: tenant.tenantId, _key: "cash.approve" }),
    open
      ? supabase
          .from("cash_movements")
          .select(
            "id, kind, category, amount_cents, note, status, auto_approved, created_at, created_by",
          )
          .eq("session_id", open.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ])
  const canApprove = canApproveData === true

  // Both cashier_id and created_by point at auth.users, not profiles, so
  // PostgREST can't infer either join — resolve every display name at once.
  const rows = closed ?? []
  const movementsRaw = movementRows ?? []
  const personIds = [
    ...new Set([
      ...rows.map((s) => s.cashier_id),
      ...movementsRaw.map((m) => m.created_by),
    ]),
  ].filter(Boolean)
  const { data: profiles } = personIds.length
    ? await supabase.from("profiles").select("id, full_name, username").in("id", personIds)
    : { data: [] }
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id, p.full_name || (p.username ? `@${p.username}` : null)]),
  )

  // Movement totals for the closed sessions on show, so a shift report can say
  // what left the drawer and how much of it no manager ever reviewed.
  const closedIds = rows.map((s) => s.id)
  const { data: closedMovements } = closedIds.length
    ? await supabase
        .from("cash_movements")
        .select("session_id, kind, amount_cents, auto_approved, status")
        .in("session_id", closedIds)
        .eq("status", "approved")
    : { data: [] }

  const bySession = new Map<
    string,
    { payouts: number; paidIn: number; auto: number }
  >()
  for (const m of closedMovements ?? []) {
    const agg = bySession.get(m.session_id) ?? { payouts: 0, paidIn: 0, auto: 0 }
    if (m.kind === "payout") agg.payouts += m.amount_cents
    else agg.paidIn += m.amount_cents
    if (m.auto_approved) agg.auto += 1
    bySession.set(m.session_id, agg)
  }

  const movements: CashMovement[] = movementsRaw.map((m) => ({
    id: m.id,
    kind: m.kind,
    category: m.category,
    amount_cents: m.amount_cents,
    note: m.note,
    status: m.status,
    auto_approved: m.auto_approved,
    created_at: m.created_at,
    recorded_by: nameById.get(m.created_by) ?? null,
  }))

  const sessions: ClosedSession[] = rows.map((s) => {
    const agg = bySession.get(s.id)
    return {
      id: s.id,
      opening_float_cents: s.opening_float_cents,
      expected_cents: s.expected_cents,
      counted_cents: s.counted_cents,
      variance_cents: s.variance_cents,
      opened_at: s.opened_at,
      closed_at: s.closed_at,
      cashier: nameById.get(s.cashier_id) ?? null,
      payouts_cents: agg?.payouts ?? 0,
      paid_in_cents: agg?.paidIn ?? 0,
      auto_approved_count: agg?.auto ?? 0,
    }
  })

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
          movements={movements}
          canApprove={canApprove}
        />
        <ShiftReports sessions={sessions} currency={tenant.currency} timezone={tenant.timezone} />
      </div>
    </PageShell>
  )
}
