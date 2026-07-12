import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { KdsBoard } from "@/components/kds-board"

// KDS should reflect the kitchen live; don't cache.
export const dynamic = "force-dynamic"

export default async function KdsPage() {
  const tenant = await requirePermission("kds.view")
  const supabase = await createClient()

  const { data: kots } = await supabase
    .from("kots")
    .select(
      "id, status, created_at, station_id, kitchen_stations(name), orders(table_id, restaurant_tables!orders_table_id_fkey(label)), kot_items(id, qty, status, order_items(name_snapshot))",
    )
    .eq("tenant_id", tenant.tenantId)
    .in("status", ["new", "preparing", "ready"])
    .order("created_at", { ascending: true })

  return (
    <div className="min-h-svh bg-background p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Kitchen Display</h1>
        <p className="text-sm text-muted-foreground">
          Live tickets · bump when ready. Refresh reflects new fires.
        </p>
      </div>
      <KdsBoard kots={(kots ?? []) as never} tenantId={tenant.tenantId} />
    </div>
  )
}
