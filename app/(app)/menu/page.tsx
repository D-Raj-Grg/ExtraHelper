import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { getMyPermissions } from "@/lib/supabase/permissions"
import { MenuManager } from "@/components/menu/menu-manager"
import { PageShell, PageHeader } from "@/components/page-header"

/** `{cost_cents}` embed → number, absent (no row, or no `profit.view`) → null. */
type CostEmbed = { cost_cents: number } | null | undefined
function embedCents(embed: CostEmbed): number | null {
  return embed ? embed.cost_cents : null
}
type RawVariant = Record<string, unknown> & { item_variant_costs?: CostEmbed }
type RawItem = Record<string, unknown> & {
  menu_item_costs?: CostEmbed
  item_variants: RawVariant[]
}

export default async function MenuPage() {
  const tenant = await requirePermission("menu.view")
  const supabase = await createClient()

  // Cached per request — requirePermission above already resolved this set.
  const perms = await getMyPermissions(tenant.tenantId)
  const canViewProfit = perms.includes("profit.view")
  const can86 = perms.includes("menu.86")
  // Costs live in RLS-gated side tables; without `profit.view` the embed
  // returns no rows, so it is only asked for when it can answer.
  const itemCostEmbed = canViewProfit ? "menu_item_costs(cost_cents), " : ""
  const variantCostEmbed = canViewProfit ? ", item_variant_costs(cost_cents)" : ""

  const [
    { data: categories },
    { data: items },
    { data: stations },
    { data: modifiers },
    { data: combos },
    { data: printers },
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
        // is_veg must be named here: the `as never` cast below means omitting a
        // column is NOT a type error — the field would just be undefined at runtime.
        "id, name, description, base_price_cents, is_86, is_veg, image_url, category_id, " +
          itemCostEmbed +
          "item_station_routes(station_id, kitchen_stations(name)), " +
          `item_variants(id, name, price_delta_cents, sort${variantCostEmbed}), ` +
          "item_modifiers(modifier_id, is_default, max_qty, modifiers(id, name, price_cents)), " +
          "item_availability(id, day_of_week, start_time, end_time)",
      )
      .eq("tenant_id", tenant.tenantId)
      .order("name")
      // Variant order is owner-chosen (Small → Large); without this the
      // embedded rows come back in no defined order and reshuffle per fetch.
      .order("sort", { referencedTable: "item_variants" }),
    supabase
      .from("kitchen_stations")
      .select("id, name, kind, printer_id")
      .eq("tenant_id", tenant.tenantId)
      .order("name"),
    supabase.from("modifiers").select("id, name, price_cents").eq("tenant_id", tenant.tenantId).order("name"),
    supabase
      .from("combos")
      .select("id, name, price_cents, items, is_active")
      .eq("tenant_id", tenant.tenantId)
      .order("name"),
    // Any active printer can be a station's route — a station printer is an
    // explicit choice, not something the document assignment gets to veto.
    supabase.from("printers").select("id, name").eq("tenant_id", tenant.tenantId).eq("is_active", true).order("name"),
  ])

  // Components keep receiving a flat `cost_cents: number | null` on the dish
  // and on each variant.
  const itemRows = ((items ?? []) as unknown as RawItem[]).map(({ menu_item_costs, item_variants, ...it }) => ({
    ...it,
    cost_cents: embedCents(menu_item_costs),
    item_variants: (item_variants ?? []).map(({ item_variant_costs, ...v }) => ({
      ...v,
      cost_cents: embedCents(item_variant_costs),
    })),
  }))

  return (
    <PageShell>
      <PageHeader
        title="Menu"
        description={<>Manage what you sell — organized into tabs so you can find things fast.</>}
      />
      <MenuManager
        currency={tenant.currency}
        categories={categories ?? []}
        items={itemRows as never}
        stations={stations ?? []}
        printers={printers ?? []}
        modifiers={modifiers ?? []}
        combos={(combos ?? []) as never}
        canViewProfit={canViewProfit}
        can86={can86}
      />
    </PageShell>
  )
}
