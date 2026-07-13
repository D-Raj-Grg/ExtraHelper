import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { InventoryManager } from "@/components/inventory-manager"
import { startCount } from "@/app/(app)/inventory/actions"
import { formatDateTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function InventoryPage() {
  const tenant = await requirePermission("inventory.view")
  const supabase = await createClient()

  const [{ data: items }, { data: menu }, { data: recipes }, { data: counts }] = await Promise.all([
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
    supabase
      .from("stock_counts")
      .select("id, created_at, posted_at")
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false })
      .limit(5),
  ])

  const canCount = ["owner", "manager", "inventory"].includes(tenant.role)

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

      {canCount ? (
        <section className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Stock counts</h2>
            <form action={startCount}>
              <Button size="sm" type="submit">
                Start stock count
              </Button>
            </form>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            Snapshot on-hand, enter actual counts, then post to reconcile (variance → shrinkage/wastage).
          </p>
          {counts && counts.length > 0 ? (
            <ul className="divide-y rounded-lg border text-sm">
              {counts.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/inventory/count/${c.id}`}
                    className="flex items-center justify-between px-3 py-2 hover:bg-muted/50"
                  >
                    <span>{formatDateTime(c.created_at, tenant.timezone)}</span>
                    <span
                      className={
                        c.posted_at
                          ? "text-xs text-green-600 dark:text-green-400"
                          : "text-xs text-amber-600 dark:text-amber-400"
                      }
                    >
                      {c.posted_at ? "posted" : "draft"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No counts yet.</p>
          )}
        </section>
      ) : null}
    </PageShell>
  )
}
