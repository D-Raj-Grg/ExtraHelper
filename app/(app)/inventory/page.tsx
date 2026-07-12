import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { InventoryManager } from "@/components/inventory-manager"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function InventoryPage() {
  const tenant = await requirePermission("inventory.view")
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
    <PageShell>
      <PageHeader
        title={<>{tenant.name} · Inventory</>}
        description="Stock levels, low-stock alerts, and recipe (BOM) mapping. Sales auto-deduct."
      />
      <InventoryManager
        currency={tenant.currency}
        items={items ?? []}
        menu={menu ?? []}
        recipes={(recipes ?? []) as never}
      />
    </PageShell>
  )
}
