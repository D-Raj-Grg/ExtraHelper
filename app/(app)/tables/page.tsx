import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { TablesManager } from "@/components/tables-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export default async function TablesPage() {
  const tenant = await requirePermission("tables.view")
  const supabase = await createClient()

  const [{ data: floors }, { data: tables }, { data: activeOrders }] = await Promise.all([
    supabase.from("floors").select("id, name").eq("tenant_id", tenant.tenantId).order("sort").order("name"),
    supabase
      .from("restaurant_tables")
      .select("id, label, capacity, state, qr_token, floor_id, pos_x, pos_y, shape, current_order_id")
      .eq("tenant_id", tenant.tenantId)
      .order("label"),
    supabase
      .from("orders")
      .select("id, table_id, status, order_items(id, name_snapshot, qty, unit_price_cents, is_void)")
      .eq("tenant_id", tenant.tenantId)
      .not("status", "in", "(closed,cancelled)")
      .not("table_id", "is", null),
  ])

  return (
    <PageShell>
      <PageHeader
        title={<>{tenant.name} · Floors &amp; Tables</>}
        description="Floors, tables, live states, drag-to-arrange floor map and dine-in QR tokens."
      />
      <TablesManager
        floors={floors ?? []}
        tables={(tables ?? []) as never}
        activeOrders={(activeOrders ?? []) as never}
        currency={tenant.currency}
        tenantId={tenant.tenantId}
      />
    </PageShell>
  )
}
