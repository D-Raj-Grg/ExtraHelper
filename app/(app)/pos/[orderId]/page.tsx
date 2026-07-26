import { notFound } from "next/navigation"
import { requirePermission } from "@/lib/supabase/guards"
import { PageShell, PageHeader } from "@/components/page-header"
import { MenuRealtimeRefresh } from "@/components/menu-realtime-refresh"
import { PosScreen } from "@/components/pos/pos-screen"
import { loadOrderDetail, loadPosData } from "../data"

export const dynamic = "force-dynamic"

/**
 * A deep link to one order — the same board as /pos, with the composer already
 * open on it. Kept because fireOrder and the offline sync both push here, and
 * because a pasted link should work. Closing the modal drops back to /pos.
 */
export default async function OrderBuilderPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  const tenant = await requirePermission("order.view")

  const [data, detail] = await Promise.all([
    loadPosData(tenant.tenantId),
    loadOrderDetail(orderId, tenant.tenantId),
  ])

  if (!detail) notFound()

  return (
    <PageShell>
      <PageHeader
        title="POS"
        description={`Take orders for ${tenant.name}. Works offline — orders queue and sync on reconnect.`}
      />
      <MenuRealtimeRefresh tenantId={tenant.tenantId} />
      <PosScreen
        data={data}
        currency={tenant.currency}
        timeZone={tenant.timezone}
        tenantId={tenant.tenantId}
        openOrderId={orderId}
        initialDetail={detail}
      />
    </PageShell>
  )
}
