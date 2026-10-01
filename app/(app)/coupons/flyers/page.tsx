import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { getMyPermissions } from "@/lib/supabase/permissions"
import type { CouponBatchRow } from "@/lib/coupon-constants"
import { PageShell, PageHeader } from "@/components/page-header"
import { CouponTabs } from "@/components/coupons/coupon-tabs"
import { DEFAULT_PLACEMENT, parsePlacement } from "@/lib/flyer"
import { FlyerStudio, type StudioCode, type StudioDesign } from "@/components/coupons/flyer-studio"

export const dynamic = "force-dynamic"

/** How long a signed template URL stays valid; the page re-signs on every load. */
const DESIGN_URL_TTL_SECONDS = 3600

/**
 * Print runs: hundreds of unique, single-use codes laid onto a flyer template,
 * then printed as a PDF or shared one by one (WhatsApp, share sheet). Each
 * flyer's code works once, so the table says how many of a run came back.
 */
export default async function CouponFlyersPage() {
  const tenant = await requirePermission("coupons.view")
  const supabase = await createClient()

  const [{ data: rows, error }, { data: designRows }, permissions] = await Promise.all([
    supabase.rpc("list_coupon_batches", { _tenant: tenant.tenantId }),
    supabase.rpc("list_flyer_designs", { _tenant: tenant.tenantId }),
    getMyPermissions(tenant.tenantId),
  ])

  // The template bucket is private: sign every design's picture in one call.
  const rawDesigns = (designRows ?? []) as {
    id: string
    name: string
    image_path: string
    width: number
    height: number
    placement: unknown
    mode: string
    link_base: string | null
  }[]
  const { data: signed } = rawDesigns.length
    ? await supabase.storage
        .from("flyer-templates")
        .createSignedUrls(rawDesigns.map((d) => d.image_path), DESIGN_URL_TTL_SECONDS)
    : { data: [] }
  const urlByPath = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]))
  const designs: StudioDesign[] = rawDesigns.flatMap((d) => {
    const url = urlByPath.get(d.image_path)
    if (!url) return []
    return [{
      id: d.id,
      name: d.name,
      url,
      width: d.width,
      height: d.height,
      placement: parsePlacement(JSON.stringify(d.placement)) ?? DEFAULT_PLACEMENT,
      mode: d.mode === "code" ? "code" : "url",
      linkBase: d.link_base,
    }]
  })

  const batches: CouponBatchRow[] = ((rows ?? []) as CouponBatchRow[]).map((b) => ({
    ...b,
    value: Number(b.value),
    issued: Number(b.issued),
    redeemed: Number(b.redeemed),
    active: Number(b.active),
    shared: Number(b.shared),
    design_id: b.design_id ?? null,
  }))

  // The newest run opens ready to use: most people have just the one.
  const first = batches[0]
  let initialCodes: StudioCode[] = []
  if (first) {
    const { data } = await supabase.rpc("get_batch_codes", { _batch: first.id })
    initialCodes = ((data ?? []) as StudioCode[]).map((c) => ({
      code: c.code,
      redeemed: c.redeemed,
      shared: c.shared,
    }))
  }

  return (
    <PageShell>
      <PageHeader
        title="Coupons"
        description={`Codes ${tenant.name} hands out on flyers and posts. Print them, or share each flyer on WhatsApp.`}
      />
      <CouponTabs active="flyers" />
      <FlyerStudio
        batches={batches}
        loadError={error?.message ?? null}
        tenantName={tenant.name}
        slug={tenant.slug}
        currency={tenant.currency}
        timezone={tenant.timezone}
        canManage={permissions.includes("coupons.manage")}
        designs={designs}
        initialBatchId={first?.id ?? null}
        initialDesignId={first?.design_id ?? null}
        initialCodes={initialCodes}
      />
    </PageShell>
  )
}
