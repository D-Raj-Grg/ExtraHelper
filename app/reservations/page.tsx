import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { ReservationsManager } from "@/components/reservations-manager"

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
    <div className="mx-auto w-full max-w-4xl p-6 md:p-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{tenant.name} · Reservations</h1>
        <p className="text-sm text-muted-foreground">
          Host board — book, confirm, seat, or cancel.
        </p>
      </div>
      <ReservationsManager
        reservations={(reservations ?? []) as never}
        tables={tables ?? []}
        timezone={tenant.timezone}
      />
    </div>
  )
}
