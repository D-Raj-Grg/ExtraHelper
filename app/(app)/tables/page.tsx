import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { TablesManager } from "@/components/tables-manager"
import { PageShell, PageHeader } from "@/components/page-header"

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
    <PageShell>
      <PageHeader
        title={<>{tenant.name} · Floors &amp; Tables</>}
        description="Floors, tables, live states and dine-in QR tokens."
      />
      <TablesManager floors={floors ?? []} tables={tables ?? []} />
    </PageShell>
  )
}
