import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { PageShell, PageHeader } from "@/components/page-header"
import { PosActiveOrders } from "@/components/pos-active-orders"
import { QuickOrder } from "@/components/quick-order"

export const dynamic = "force-dynamic"

export default async function PosPage() {
  const tenant = await requireRole("owner", "manager", "cashier", "waiter")
  const supabase = await createClient()

  const [{ data: tables }, { data: menu }, { data: orders }] = await Promise.all([
    supabase
      .from("restaurant_tables")
      .select("id, label, state")
      .eq("tenant_id", tenant.tenantId)
      .order("label"),
    supabase
      .from("menu_items")
      .select("id, name, base_price_cents, is_86")
      .eq("tenant_id", tenant.tenantId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("orders")
      .select("id, order_type, status, created_at, restaurant_tables!orders_table_id_fkey(label)")
      .eq("tenant_id", tenant.tenantId)
      .in("status", ["draft", "placed", "in_kitchen", "preparing", "ready", "served"])
      .order("created_at", { ascending: false }),
  ])

  // Supabase types the to-one embed as an array; runtime is a single object.
  const orderRows = (orders ?? []) as unknown as {
    id: string
    status: string
    restaurant_tables: { label: string } | null
  }[]

  return (
    <PageShell>
      <PageHeader
        title={<>{tenant.name} · POS</>}
        description="Build an order (works offline — queues and syncs on reconnect)."
      />

      <section className="mb-8">
        <QuickOrder menu={menu ?? []} tables={tables ?? []} currency={tenant.currency} />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Active orders</h2>
        <PosActiveOrders initial={orderRows} tenantId={tenant.tenantId} />
      </section>
    </PageShell>
  )
}
