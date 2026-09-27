import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { getMyPermissions } from "@/lib/supabase/permissions"
import { InventoryManager } from "@/components/inventory/inventory-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

/** Tabs the URL may deep-link to (`?tab=costing` from the profit report). */
const TABS = ["stock", "recipes", "costing", "counts"] as const
type Tab = (typeof TABS)[number]

/** `{cost_cents}` embed → number, absent (no row, or no `profit.view`) → null. */
type CostEmbed = { cost_cents: number } | null | undefined
function embedCents(embed: CostEmbed): number | null {
  return embed ? embed.cost_cents : null
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tenant = await requirePermission("inventory.view")
  const supabase = await createClient()
  const { tab } = await searchParams
  const defaultTab: Tab = (TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : "stock"

  // Cached per request — requirePermission above already resolved this set.
  const perms = await getMyPermissions(tenant.tenantId)
  const canViewProfit = perms.includes("profit.view")
  // Costs live in RLS-gated side tables; without `profit.view` the embed
  // returns no rows, so it is only asked for when it can answer.
  const itemCostEmbed = canViewProfit ? ", menu_item_costs(cost_cents)" : ""
  const variantCostEmbed = canViewProfit ? ", item_variant_costs(cost_cents)" : ""
  const modifierCostEmbed = canViewProfit ? ", modifier_costs(cost_cents)" : ""

  const [
    { data: items },
    { data: menu },
    { data: recipes },
    { data: variants },
    { data: modifiers },
    { data: modifierIngredients },
    { data: suppliers },
    { data: counts },
    { data: costHistory },
    { data: units },
  ] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("id, name, uom, category, current_qty, reorder_level, par_level, cost_cents, supplier_id, barcode")
      .eq("tenant_id", tenant.tenantId)
      .order("name"),
    supabase
      .from("menu_items")
      .select(`id, name, price_cents:base_price_cents${itemCostEmbed}`)
      .eq("tenant_id", tenant.tenantId)
      .order("name"),
    supabase
      .from("recipes")
      .select("id, qty, menu_item_id, inventory_item_id, menu_items(name), inventory_items(name, uom)")
      .eq("tenant_id", tenant.tenantId)
      .order("id"),
    supabase
      .from("item_variants")
      .select(`id, item_id, name, recipe_scale, price_delta_cents${variantCostEmbed}`)
      .eq("tenant_id", tenant.tenantId)
      .order("name"),
    supabase
      .from("modifiers")
      .select(`id, name, price_cents${modifierCostEmbed}`)
      .eq("tenant_id", tenant.tenantId)
      .order("name"),
    supabase
      .from("modifier_ingredients")
      .select("id, modifier_id, inventory_item_id, qty")
      .eq("tenant_id", tenant.tenantId),
    supabase.from("suppliers").select("id, name").eq("tenant_id", tenant.tenantId).order("name"),
    supabase
      .from("stock_counts")
      .select("id, created_at, posted_at")
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false })
      .limit(5),
    // Purchase movements form the unit-cost (price) history per item.
    supabase
      .from("stock_movements")
      .select("inventory_item_id, qty, unit_cost_cents, created_at")
      .eq("tenant_id", tenant.tenantId)
      .eq("type", "purchase")
      .not("unit_cost_cents", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("inventory_units").select("id, name, kind").eq("tenant_id", tenant.tenantId).order("name"),
  ])

  const canCount = ["owner", "manager", "inventory"].includes(tenant.role)

  // Components keep receiving a flat `cost_cents: number | null`.
  const menuRows = (
    (menu ?? []) as unknown as (Record<string, unknown> & {
      menu_item_costs?: CostEmbed
    })[]
  ).map(({ menu_item_costs, ...m }) => ({
    ...m,
    cost_cents: embedCents(menu_item_costs),
  }))
  const variantRows = (
    (variants ?? []) as unknown as (Record<string, unknown> & {
      item_variant_costs?: CostEmbed
    })[]
  ).map(({ item_variant_costs, ...v }) => ({
    ...v,
    cost_cents: embedCents(item_variant_costs),
  }))

  const modifierRows = (
    (modifiers ?? []) as unknown as (Record<string, unknown> & {
      modifier_costs?: CostEmbed
    })[]
  ).map(({ modifier_costs, ...m }) => ({
    ...m,
    cost_cents: embedCents(modifier_costs),
  }))

  return (
    <PageShell>
      <PageHeader
        title="Inventory"
        description={`${tenant.name} — track ingredients, map recipes so sales auto-deduct stock, and reconcile with counts.`}
      />
      <InventoryManager
        currency={tenant.currency}
        timezone={tenant.timezone}
        items={(items ?? []) as never}
        menu={menuRows as never}
        recipes={(recipes ?? []) as never}
        variants={variantRows as never}
        modifiers={modifierRows as never}
        modifierIngredients={(modifierIngredients ?? []) as never}
        suppliers={suppliers ?? []}
        costHistory={(costHistory ?? []) as never}
        counts={counts ?? []}
        units={units ?? []}
        canCount={canCount}
        canViewProfit={canViewProfit}
        defaultTab={defaultTab}
      />
    </PageShell>
  )
}
