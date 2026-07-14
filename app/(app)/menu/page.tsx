import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { MenuManager } from "@/components/menu/menu-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export default async function MenuPage() {
  const tenant = await requirePermission("menu.view")
  const supabase = await createClient()

  const [
    { data: categories },
    { data: items },
    { data: stations },
    { data: modifiers },
    { data: combos },
  ] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("id, name, sort, is_active")
      .eq("tenant_id", tenant.tenantId)
      .order("sort")
      .order("name"),
    supabase
      .from("menu_items")
      .select(
        "id, name, description, base_price_cents, is_86, image_url, category_id, " +
          "item_station_routes(station_id, kitchen_stations(name)), " +
          "item_variants(id, name, price_delta_cents), " +
          "item_modifiers(modifier_id, is_default, max_qty, modifiers(id, name, price_cents)), " +
          "item_availability(id, day_of_week, start_time, end_time)",
      )
      .eq("tenant_id", tenant.tenantId)
      .order("name"),
    supabase.from("kitchen_stations").select("id, name").eq("tenant_id", tenant.tenantId).order("name"),
    supabase.from("modifiers").select("id, name, price_cents").eq("tenant_id", tenant.tenantId).order("name"),
    supabase.from("combos").select("id, name, price_cents, items, is_active").eq("tenant_id", tenant.tenantId).order("name"),
  ])

  return (
    <PageShell>
      <PageHeader
        title={<>{tenant.name} · Menu</>}
        description={<>Manage what you sell — organized into tabs so you can find things fast.</>}
      />
      <MenuManager
        currency={tenant.currency}
        categories={categories ?? []}
        items={(items ?? []) as never}
        stations={stations ?? []}
        modifiers={modifiers ?? []}
        combos={(combos ?? []) as never}
      />
    </PageShell>
  )
}
