import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { getMyPermissions } from "@/lib/supabase/permissions"
import type { CouponBatchRow, CouponRow, CouponStats } from "@/lib/coupon-constants"
import { PageShell, PageHeader } from "@/components/page-header"
import { CouponsBoard } from "@/components/coupons/coupons-board"
import { CouponTabs } from "@/components/coupons/coupon-tabs"
import { CouponStatsCards } from "@/components/coupons/coupon-stats"
import { FlyerRunsCard } from "@/components/coupons/flyer-runs-card"

export const dynamic = "force-dynamic"

/**
 * Campaign codes: what marketing prints on a flyer or posts with a photo. A
 * guest scans the QR (or types the code) and the discount applies itself at
 * checkout; a cashier types it on the POS; the mobile app scans it.
 */
export default async function CouponsPage() {
  const tenant = await requirePermission("coupons.view")
  const supabase = await createClient()

  const [{ data: rows, error }, { data: statRows }, { data: runRows }, permissions] = await Promise.all([
    supabase.rpc("list_coupons", { _tenant: tenant.tenantId }),
    supabase.rpc("coupon_stats", { _tenant: tenant.tenantId }),
    supabase.rpc("list_coupon_batches", { _tenant: tenant.tenantId }),
    getMyPermissions(tenant.tenantId),
  ])

  const s = (statRows ?? [])[0]
  const stats: CouponStats = {
    active: Number(s?.active ?? 0),
    scheduled: Number(s?.scheduled ?? 0),
    expired: Number(s?.expired ?? 0),
    used_up: Number(s?.used_up ?? 0),
    paused: Number(s?.paused ?? 0),
    redemptions: Number(s?.redemptions ?? 0),
    discount_given_cents: Number(s?.discount_given_cents ?? 0),
  }
  const runs: CouponBatchRow[] = ((runRows ?? []) as CouponBatchRow[]).map((b) => ({
    ...b,
    value: Number(b.value),
    issued: Number(b.issued),
    redeemed: Number(b.redeemed),
    active: Number(b.active),
    shared: Number(b.shared),
  }))

  const coupons: CouponRow[] = ((rows ?? []) as CouponRow[]).map((c) => ({
    ...c,
    value: Number(c.value),
    redemptions: Number(c.redemptions),
    discount_given_cents: Number(c.discount_given_cents),
  }))

  return (
    <PageShell>
      <PageHeader
        title="Coupons"
        description={`Codes ${tenant.name} hands out on flyers and posts. A guest scans or types one and the discount applies itself at checkout.`}
      />
      <CouponTabs active="coupons" />
      <div className="mb-6 flex flex-col gap-6">
        <CouponStatsCards stats={stats} currency={tenant.currency} />
        <FlyerRunsCard runs={runs} currency={tenant.currency} timezone={tenant.timezone} />
      </div>
      <CouponsBoard
        flyerRuns={runs.length}
        coupons={coupons}
        loadError={error?.message ?? null}
        slug={tenant.slug}
        currency={tenant.currency}
        timezone={tenant.timezone}
        canManage={permissions.includes("coupons.manage")}
      />
    </PageShell>
  )
}
