import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { InventoryManager } from "@/components/inventory-manager"

export const dynamic = "force-dynamic"

export default async function InventoryPage() {
  const tenant = await requireRole("owner", "manager", "inventory")
  const supabase = await createClient()

  const [{ data: items }, { data: menu }, { data: recipes }] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("id, name, uom, current_qty, reorder_level, cost_cents")
      .eq("tenant_id", tenant.tenantId)
      .order("name"),
    supabase.from("menu_items").select("id, name").eq("tenant_id", tenant.tenantId).order("name"),
    supabase
      .from("recipes")
      .select("id, qty, menu_items(name), inventory_items(name, uom)")
      .eq("tenant_id", tenant.tenantId)
      .order("id"),
  ])

  return (
    <div className="mx-auto w-full max-w-4xl p-6 md:p-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{tenant.name} · Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Stock levels, low-stock alerts, and recipe (BOM) mapping. Sales auto-deduct.
        </p>
      </div>
      <InventoryManager
        currency={tenant.currency}
        items={items ?? []}
        menu={menu ?? []}
        recipes={(recipes ?? []) as never}
      />
    </div>
  )
}
