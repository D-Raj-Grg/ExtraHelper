import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { CashManager } from "@/components/cash-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function CashPage() {
  const tenant = await requirePermission("cash.view")
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: open } = await supabase
    .from("cash_sessions")
    .select("id, opening_float_cents, opened_at")
    .eq("cashier_id", user!.id)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  // Recent closed sessions = shift reports.
  const { data: closed } = await supabase
    .from("cash_sessions")
    .select("id, opening_float_cents, expected_cents, counted_cents, variance_cents, opened_at, closed_at")
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(10)

  return (
    <PageShell width="narrow">
      <PageHeader
        title={<>{tenant.name} · Cash Drawer</>}
        description="Open a session, reconcile counted vs expected at close."
      />
      <CashManager
        currency={tenant.currency}
        timezone={tenant.timezone}
        openSessionRow={open ?? null}
        closedSessions={closed ?? []}
      />
    </PageShell>
  )
}
