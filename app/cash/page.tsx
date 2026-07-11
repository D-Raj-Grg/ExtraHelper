import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { CashManager } from "@/components/cash-manager"

export const dynamic = "force-dynamic"

export default async function CashPage() {
  const tenant = await requireRole("owner", "manager", "cashier")
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
    <div className="mx-auto w-full max-w-2xl p-6 md:p-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{tenant.name} · Cash Drawer</h1>
        <p className="text-sm text-muted-foreground">
          Open a session, reconcile counted vs expected at close.
        </p>
      </div>
      <CashManager
        currency={tenant.currency}
        timezone={tenant.timezone}
        openSessionRow={open ?? null}
        closedSessions={closed ?? []}
      />
    </div>
  )
}
