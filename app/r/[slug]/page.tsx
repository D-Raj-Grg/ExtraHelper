import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { StarIcon } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { ReviewComposer } from "@/components/reviews/review-composer"
import { MIN_COUNT_TO_SHOW } from "@/lib/review-composer"

export const dynamic = "force-dynamic"

/** Shape of the `review_page(slug)` payload. */
type ReviewPage = {
  tenant_name: string
  slug: string
  place_id: string | null
  listing_url: string | null
  score: number | null
  count: number | null
  checked: string | null
  contact_phone: string | null
}

async function load(slug: string): Promise<ReviewPage | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("review_page", { _slug: slug })
  return (data as ReviewPage | null) ?? null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const page = await load(slug)
  if (!page) return { title: "Leave a review" }

  return {
    title: `Leave a review · ${page.tenant_name}`,
    description: `Ate at ${page.tenant_name}? Pick a rating, tap what stood out, and post it in under a minute.`,
    // This is the short URL behind a table card or a receipt footer. It is for
    // guests who have already eaten here, not a page that should compete in
    // search against the restaurant's own listing.
    robots: { index: false, follow: true },
  }
}

export default async function ReviewPageRoute({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const page = await load(slug)

  // Null covers all four dead ends — unknown slug, suspended restaurant, page
  // switched off, and no listing to send anyone to.
  if (!page) notFound()

  const hasScore = page.score !== null
  const showCount = page.count !== null && page.count >= MIN_COUNT_TO_SHOW

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background px-4 pb-10">
      <header className="pt-6 pb-2 text-center">
        <h1 className="text-2xl leading-tight font-bold tracking-tight">{page.tenant_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Thanks for eating with us — a minute of your time helps the next guest find us.
        </p>

        {hasScore ? (
          // Shown as Google reports it, not as our own claim, and deliberately
          // not emitted as aggregateRating JSON-LD: Google ignores a business's
          // self-declared rating on its own page and can penalise it.
          <p className="mt-4 flex items-center justify-center gap-2 text-sm">
            <StarIcon className="size-4 fill-current" aria-hidden />
            <span className="font-semibold tabular-nums">{page.score!.toFixed(1)}</span>
            <span className="text-muted-foreground">
              on Google
              {showCount ? (
                <>
                  {" · "}
                  <span className="tabular-nums">{page.count}</span>{" "}
                  {page.count === 1 ? "review" : "reviews"}
                </>
              ) : null}
            </span>
          </p>
        ) : null}
      </header>

      <main className="pt-4">
        <ReviewComposer
          restaurantName={page.tenant_name}
          placeId={page.place_id}
          listingUrl={page.listing_url}
          contactPhone={page.contact_phone}
        />
      </main>
    </div>
  )
}
