import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { KdsBoard } from "@/components/kds-board"
import { EightySixPanel } from "@/components/eighty-six-panel"
import { kdsActiveQuery } from "@/lib/kds-constants"

// KDS should reflect the kitchen live; don't cache.
export const dynamic = "force-dynamic"

export default async function KdsPage({
  searchParams,
}: {
  searchParams: Promise<{ station?: string }>
}) {
  const tenant = await requirePermission("kds.view")
  const supabase = await createClient()
  // Normalise once: the query and the board must agree on what "no station"
  // means, and they used to disagree (undefined here, "all" there).
  const { station: stationParam } = await searchParams
  const station = stationParam ?? "all"

  const [{ data: stations }, { data: menuItems }] = await Promise.all([
    supabase
      .from("kitchen_stations")
      .select("id, name")
      .eq("tenant_id", tenant.tenantId)
      .order("name"),
    supabase
      .from("menu_items")
      .select("id, name, is_86")
      .eq("tenant_id", tenant.tenantId)
      .eq("is_active", true)
      .order("name"),
  ])

  // Active tickets — station scoping and the settled-order exclusion both live
  // in the builder, so the client's Realtime refetch cannot drift from this.
  const { data: kots } = await kdsActiveQuery(supabase, tenant.tenantId, station)

  return (
    <div className="min-h-svh bg-background p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Kitchen Display</h1>
        <p className="text-sm text-muted-foreground">
          Live tickets · bump when ready. Filter to this screen&apos;s station.
        </p>
      </div>
      <div className="mb-3">
        <EightySixPanel items={menuItems ?? []} tenantId={tenant.tenantId} />
      </div>
      <KdsBoard
        kots={(kots ?? []) as never}
        stations={stations ?? []}
        station={station}
        tenantId={tenant.tenantId}
      />
    </div>
  )
}
