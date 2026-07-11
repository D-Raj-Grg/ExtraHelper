import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { ReservationsManager } from "@/components/reservations-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function ReservationsPage() {
  const tenant = await requireRole("owner", "manager", "receptionist")
  const supabase = await createClient()

  const [{ data: reservations }, { data: tables }] = await Promise.all([
    supabase
      .from("reservations")
      .select(
        "id, party_size, reserved_at, status, notes, customers(name, phone), restaurant_tables(label)",
      )
      .eq("tenant_id", tenant.tenantId)
      .order("reserved_at", { ascending: true }),
    supabase
      .from("restaurant_tables")
      .select("id, label, capacity")
      .eq("tenant_id", tenant.tenantId)
      .order("label"),
  ])

  return (
    <PageShell>
      <PageHeader
        title={<>{tenant.name} · Reservations</>}
        description="Host board — book, confirm, seat, or cancel."
      />
      <ReservationsManager
        reservations={(reservations ?? []) as never}
        tables={tables ?? []}
        timezone={tenant.timezone}
      />
    </PageShell>
  )
}
