import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { MenuManager } from "@/components/menu-manager"

export default async function MenuPage() {
  const tenant = await requireRole("owner", "manager")
  const supabase = await createClient()

  const [{ data: categories }, { data: items }, { data: stations }] =
    await Promise.all([
      supabase
        .from("menu_categories")
        .select("id, name")
        .eq("tenant_id", tenant.tenantId)
        .order("sort")
        .order("name"),
      supabase
        .from("menu_items")
        .select(
          "id, name, base_price_cents, is_86, category_id, item_station_routes(station_id, kitchen_stations(name))",
        )
        .eq("tenant_id", tenant.tenantId)
        .order("name"),
      supabase.from("kitchen_stations").select("id, name").eq("tenant_id", tenant.tenantId).order("name"),
    ])

  return (
    <div className="mx-auto w-full max-w-4xl p-6 md:p-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{tenant.name} · Menu</h1>
        <p className="text-sm text-muted-foreground">
          Categories, items, kitchen stations and 86 (out-of-stock) toggles.
        </p>
      </div>
      <MenuManager
        currency={tenant.currency}
        categories={categories ?? []}
        items={(items ?? []) as never}
        stations={stations ?? []}
      />
    </div>
  )
}
