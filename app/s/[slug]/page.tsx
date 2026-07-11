import { notFound } from "next/navigation"
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
    items: { id: string; name: string; description: string | null; price_cents: number }[]
  }[]
}

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()
  const { data } = await supabase.rpc("storefront_menu", { _slug: slug })
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
    </div>
  )
}
