import Link from "next/link"
import { notFound } from "next/navigation"
import { StarIcon } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { Storefront } from "@/components/storefront"

export const dynamic = "force-dynamic"

type Menu = {
  tenant_name: string
  currency: string
  fees: Record<string, number>
  categories: {
    id: string
    name: string
    items: { id: string; name: string; description: string | null; price_cents: number; is_veg: boolean | null }[]
  }[]
}

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()
  // Two independent public RPCs, so they go together. `review_page` returns
  // null whenever the review page is off or has nothing to link to, which is
  // exactly the condition for not offering it here either.
  const [{ data }, { data: review }] = await Promise.all([
    supabase.rpc("storefront_menu", { _slug: slug }),
    supabase.rpc("review_page", { _slug: slug }),
  ])
  if (!data) notFound()
  const menu = data as Menu

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background p-4">
      <div className="mb-4 text-center">
        <h1 className="text-xl font-bold">{menu.tenant_name}</h1>
        <p className="text-sm text-muted-foreground">Order online · delivery or pickup</p>
      </div>
      <Storefront
        slug={slug}
        currency={menu.currency}
        fees={menu.fees ?? {}}
        categories={menu.categories}
      />

      {review ? (
        <Link
          href={`/r/${slug}`}
          className="mt-6 flex min-h-11 items-center justify-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm font-semibold transition-colors hover:bg-muted motion-reduce:transition-none"
        >
          <StarIcon className="size-4" aria-hidden />
          Eaten here before? Leave us a review
        </Link>
      ) : null}
    </div>
  )
}
