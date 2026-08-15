import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { InventoryManager } from "@/components/inventory/inventory-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function InventoryPage() {
  const tenant = await requirePermission("inventory.view")
  const supabase = await createClient()

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
        .select("id, name, price_cents:base_price_cents")
        .eq("tenant_id", tenant.tenantId)
        .order("name"),
      supabase
        .from("recipes")
        .select("id, qty, menu_item_id, inventory_item_id, menu_items(name), inventory_items(name, uom)")
        .eq("tenant_id", tenant.tenantId)
        .order("id"),
      supabase
        .from("item_variants")
        .select("id, item_id, name, recipe_scale")
        .eq("tenant_id", tenant.tenantId)
        .order("name"),
      supabase
        .from("modifiers")
        .select("id, name")
        .eq("tenant_id", tenant.tenantId)
        .order("name"),
      supabase
        .from("modifier_ingredients")
        .select("id, modifier_id, inventory_item_id, qty")
        .eq("tenant_id", tenant.tenantId),
      supabase
        .from("suppliers")
        .select("id, name")
        .eq("tenant_id", tenant.tenantId)
        .order("name"),
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
      supabase
        .from("inventory_units")
        .select("id, name, kind")
        .eq("tenant_id", tenant.tenantId)
        .order("name"),
    ])

  const canCount = ["owner", "manager", "inventory"].includes(tenant.role)

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
        menu={(menu ?? []) as never}
        recipes={(recipes ?? []) as never}
        variants={(variants ?? []) as never}
        modifiers={modifiers ?? []}
        modifierIngredients={(modifierIngredients ?? []) as never}
        suppliers={suppliers ?? []}
        costHistory={(costHistory ?? []) as never}
        counts={counts ?? []}
        units={units ?? []}
        canCount={canCount}
      />
    </PageShell>
  )
}
