import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { PosBuilder } from "@/components/pos-builder"
import { PageShell } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function OrderBuilderPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  const tenant = await requirePermission("order.view")
  const supabase = await createClient()

  const [{ data: order }, { data: items }, { data: menu }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, status, order_type, restaurant_tables!orders_table_id_fkey(label)")
      .eq("id", orderId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("id, name_snapshot, qty, unit_price_cents, status, is_void")
      .eq("order_id", orderId)
      .eq("tenant_id", tenant.tenantId)
      .order("created_at"),
    supabase
      .from("menu_items")
      .select("id, name, base_price_cents, is_86")
      .eq("tenant_id", tenant.tenantId)
      .eq("is_active", true)
      .order("name"),
  ])

  if (!order) notFound()

  return (
    <PageShell>
      <PosBuilder
        currency={tenant.currency}
        order={order as never}
        items={(items ?? []) as never}
        menu={(menu ?? []) as never}
      />
    </PageShell>
  )
}
