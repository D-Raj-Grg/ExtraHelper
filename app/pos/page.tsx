import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { startOrder } from "@/app/pos/actions"
import { Button } from "@/components/ui/button"

export const dynamic = "force-dynamic"

export default async function PosPage() {
  const tenant = await requireRole("owner", "manager", "cashier", "waiter")
  const supabase = await createClient()

  const [{ data: tables }, { data: orders }] = await Promise.all([
    supabase
      .from("restaurant_tables")
      .select("id, label, state")
      .eq("tenant_id", tenant.tenantId)
      .order("label"),
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
    <div className="mx-auto w-full max-w-4xl p-6 md:p-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{tenant.name} · POS</h1>
        <p className="text-sm text-muted-foreground">Start an order, then fire to the kitchen.</p>
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">New order</h2>
        <form action={startOrder} className="flex flex-wrap items-center gap-2">
          <select
            name="tableId"
            defaultValue=""
            className="border-input dark:bg-input/30 h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="">Takeaway / pickup</option>
            {(tables ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                Table {t.label} ({t.state})
              </option>
            ))}
          </select>
          <Button type="submit">Start order</Button>
        </form>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Active orders</h2>
        {orderRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active orders.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <tbody>
                {orderRows.map((o) => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">
                      {o.restaurant_tables?.label
                        ? `Table ${o.restaurant_tables.label}`
                        : "Takeaway"}
                    </td>
                    <td className="px-4 py-2 capitalize text-muted-foreground">
                      {o.status.replace("_", " ")}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/pos/${o.id}`} />}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
