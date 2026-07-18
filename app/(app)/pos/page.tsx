import { requirePermission } from "@/lib/supabase/guards"
import { PageShell, PageHeader } from "@/components/page-header"
import { MenuRealtimeRefresh } from "@/components/menu-realtime-refresh"
import { PosScreen } from "@/components/pos/pos-screen"
import type { PosTab } from "@/components/pos/pos-tabs"
import { loadPosData } from "./data"

export const dynamic = "force-dynamic"

const TABS: PosTab[] = ["orders", "table", "kot"]

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; tab?: string }>
}) {
  const tenant = await requirePermission("order.view")
  const [data, params] = await Promise.all([loadPosData(tenant.tenantId), searchParams])
  const initialTab: PosTab = TABS.includes(params.tab as PosTab) ? (params.tab as PosTab) : "orders"

  return (
    <PageShell>
      <PageHeader
        title="POS"
        description={`Take orders for ${tenant.name}. Works offline — orders queue and sync on reconnect.`}
      />
      {/* Moved up from [orderId]: an 86 has to grey the tile out on the board
          too, not only inside an open order. */}
      <MenuRealtimeRefresh tenantId={tenant.tenantId} />
      <PosScreen
        data={data}
        currency={tenant.currency}
        timeZone={tenant.timezone}
        tenantId={tenant.tenantId}
        startNew={params.new === "1"}
        initialTab={initialTab}
      />
    </PageShell>
  )
}
