import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { QrOrder } from "@/components/qr-order"

export const dynamic = "force-dynamic"

type Menu = {
  tenant_name: string
  currency: string
  table_label: string
  categories: {
    id: string
    name: string
    items: { id: string; name: string; description: string | null; price_cents: number }[]
  }[]
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

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background p-4">
      <div className="mb-4 text-center">
        <h1 className="text-xl font-bold">{menu.tenant_name}</h1>
        <p className="text-sm text-muted-foreground">Table {menu.table_label} · dine-in</p>
      </div>
      <QrOrder token={token} currency={menu.currency} categories={menu.categories} />
    </div>
  )
}
