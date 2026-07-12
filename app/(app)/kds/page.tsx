import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { KdsBoard } from "@/components/kds-board"

// KDS should reflect the kitchen live; don't cache.
export const dynamic = "force-dynamic"

const KDS_SELECT =
  "id, status, created_at, station_id, kitchen_stations(name), orders(table_id, restaurant_tables!orders_table_id_fkey(label)), kot_items(id, qty, status, order_items(name_snapshot))"

export default async function KdsPage({
  searchParams,
}: {
  searchParams: Promise<{ station?: string }>
}) {
  const tenant = await requirePermission("kds.view")
  const supabase = await createClient()
  const { station } = await searchParams

  const { data: stations } = await supabase
    .from("kitchen_stations")
    .select("id, name")
    .eq("tenant_id", tenant.tenantId)
    .order("name")

  // Active tickets — optionally scoped to one station ("expo" = unrouted/null).
  let active = supabase
    .from("kots")
    .select(KDS_SELECT)
    .eq("tenant_id", tenant.tenantId)
    .in("status", ["new", "preparing", "ready"])
    .order("created_at", { ascending: true })
  if (station === "expo") active = active.is("station_id", null)
  else if (station) active = active.eq("station_id", station)
  const { data: kots } = await active

  return (
    <div className="min-h-svh bg-background p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Kitchen Display</h1>
        <p className="text-sm text-muted-foreground">
          Live tickets · bump when ready. Filter to this screen&apos;s station.
        </p>
      </div>
      <KdsBoard
        kots={(kots ?? []) as never}
        stations={stations ?? []}
        station={station ?? "all"}
        tenantId={tenant.tenantId}
      />
    </div>
  )
}
