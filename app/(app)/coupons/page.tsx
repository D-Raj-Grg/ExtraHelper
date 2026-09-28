import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { getMyPermissions } from "@/lib/supabase/permissions"
import type { CouponRow } from "@/lib/coupon-constants"
import { PageShell, PageHeader } from "@/components/page-header"
import { CouponsBoard } from "@/components/coupons/coupons-board"

export const dynamic = "force-dynamic"

/**
 * Campaign codes: what marketing prints on a flyer or posts with a photo. A
 * guest scans the QR (or types the code) and the discount applies itself at
 * checkout; a cashier types it on the POS; the mobile app scans it.
 */
export default async function CouponsPage() {
  const tenant = await requirePermission("coupons.view")
  const supabase = await createClient()

  const [{ data: rows, error }, permissions] = await Promise.all([
    supabase.rpc("list_coupons", { _tenant: tenant.tenantId }),
    getMyPermissions(tenant.tenantId),
  ])

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
      <CouponsBoard
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
