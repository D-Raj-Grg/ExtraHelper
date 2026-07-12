import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { MenuManager } from "@/components/menu-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export default async function MenuPage() {
  const tenant = await requirePermission("menu.view")
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
    <PageShell>
      <PageHeader
        title={<>{tenant.name} · Menu</>}
        description={<>Categories, items, kitchen stations and 86 (out-of-stock) toggles.</>}
      />
      <MenuManager
        currency={tenant.currency}
        categories={categories ?? []}
        items={(items ?? []) as never}
        stations={stations ?? []}
      />
    </PageShell>
  )
}
