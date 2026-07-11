import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { TablesManager } from "@/components/tables-manager"

export default async function TablesPage() {
  const tenant = await requireRole("owner", "manager", "receptionist")
  const supabase = await createClient()

  const [{ data: floors }, { data: tables }] = await Promise.all([
    supabase.from("floors").select("id, name").eq("tenant_id", tenant.tenantId).order("sort").order("name"),
    supabase
      .from("restaurant_tables")
      .select("id, label, capacity, state, qr_token, floor_id")
      .eq("tenant_id", tenant.tenantId)
      .order("label"),
  ])

  return (
    <div className="mx-auto w-full max-w-4xl p-6 md:p-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{tenant.name} · Floors &amp; Tables</h1>
        <p className="text-sm text-muted-foreground">
          Floors, tables, live states and dine-in QR tokens.
        </p>
      </div>
      <TablesManager floors={floors ?? []} tables={tables ?? []} />
    </div>
  )
}
