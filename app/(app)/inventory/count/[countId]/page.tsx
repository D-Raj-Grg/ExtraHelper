import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { StockCountSheet } from "@/components/stock-count-sheet"
import { PageShell, PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function StockCountPage({
  params,
}: {
  params: Promise<{ countId: string }>
}) {
  const { countId } = await params
  const tenant = await requireRole("owner", "manager", "inventory")
  const supabase = await createClient()

  const [{ data: count }, { data: items }] = await Promise.all([
    supabase
      .from("stock_counts")
      .select("id, created_at, posted_at")
      .eq("id", countId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle(),
    supabase
      .from("stock_count_items")
      .select("id, theoretical_qty, actual_qty, variance, inventory_items(name, uom)")
      .eq("stock_count_id", countId)
      .eq("tenant_id", tenant.tenantId),
  ])

  if (!count) notFound()

  const rows = (items ?? [])
    .map((r) => {
      const inv = r.inventory_items as unknown as { name: string; uom: string } | null
      return {
        id: r.id,
        name: inv?.name ?? "item",
        uom: inv?.uom ?? "",
        theoretical: Number(r.theoretical_qty),
        actual: Number(r.actual_qty),
        variance: Number(r.variance),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <PageShell>
      <PageHeader
        title="Stock count"
        description={count.posted_at ? "Posted — read only" : "Enter counted quantities, then post"}
      />
      <StockCountSheet countId={count.id} rows={rows} posted={Boolean(count.posted_at)} />
    </PageShell>
  )
}
