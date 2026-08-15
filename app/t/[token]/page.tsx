import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { QrOrder } from "@/components/qr-order"
import type { QrCategory } from "@/components/qr/qr-menu-types"

export const dynamic = "force-dynamic"

type Menu = {
  tenant_name: string
  currency: string
  table_label: string
  categories: QrCategory[]
}

export default async function QrTablePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = await createClient()
  const { data } = await supabase.rpc("qr_menu", { _token: token })

  if (!data) notFound()
  const menu = data as Menu

  const dishes = menu.categories.reduce((n, c) => n + c.items.length, 0)

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background px-4 pb-4">
      {/* Scrolls away on purpose: what stays pinned is the search field below
          it, which is what a guest needs on a menu this long. */}
      <header className="pt-5 pb-3 text-center">
        <h1 className="text-2xl leading-tight font-bold tracking-tight">{menu.tenant_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Table {menu.table_label} · dine-in · {dishes} {dishes === 1 ? "dish" : "dishes"}
        </p>
      </header>
      <QrOrder token={token} currency={menu.currency} categories={menu.categories} />
    </div>
  )
}
