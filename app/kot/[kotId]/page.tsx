import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { formatDateTime } from "@/lib/format"
import { PrintOnLoad } from "@/components/kot-print"

// Always render fresh; never cache a kitchen ticket.
export const dynamic = "force-dynamic"

type Modifier = { name_snapshot: string; qty: number }
type Item = {
  id: string
  qty: number
  order_items: {
    name_snapshot: string
    notes: string | null
    seat: number | null
    course: number | null
    order_item_modifiers: Modifier[] | null
  } | null
}
type KotRow = {
  id: string
  status: string
  created_at: string
  kitchen_stations: { name: string } | null
  orders: { order_type: string; restaurant_tables: { label: string } | null } | null
  kot_items: Item[]
}

export default async function KotPrintPage({
  params,
}: {
  params: Promise<{ kotId: string }>
}) {
  const tenant = await requirePermission("kds.view")
  const { kotId } = await params
  const supabase = await createClient()

  const { data } = await supabase
    .from("kots")
    .select(
      "id, status, created_at, kitchen_stations(name), orders(order_type, restaurant_tables!orders_table_id_fkey(label)), kot_items(id, qty, order_items(name_snapshot, notes, seat, course, order_item_modifiers(name_snapshot, qty)))",
    )
    .eq("id", kotId)
    .eq("tenant_id", tenant.tenantId)
    .single()

  if (!data) notFound()
  const kot = data as unknown as KotRow
  const station = kot.kitchen_stations?.name ?? "Expo"
  const table = kot.orders?.restaurant_tables?.label
  const orderType = (kot.orders?.order_type ?? "dine_in").replace("_", " ")
  const shortId = kot.id.slice(0, 8).toUpperCase()

  return (
    <div className="mx-auto w-[80mm] max-w-full bg-white p-3 font-mono text-black">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 4mm; size: 80mm auto; }
          body { background: #fff; }
        }
      `}</style>

      <div className="text-center">
        <div className="text-lg font-bold uppercase tracking-wide">{station}</div>
        <div className="text-sm">
          {table ? `Table ${table}` : orderType.toUpperCase()}
        </div>
      </div>

      <div className="my-2 border-y border-dashed border-black py-1 text-center text-xs">
        <div>KOT #{shortId}</div>
        <div>{formatDateTime(kot.created_at, tenant.timezone)}</div>
      </div>

      <ul className="space-y-2 text-sm">
        {kot.kot_items.map((ki) => (
          <li key={ki.id}>
            <div className="flex justify-between font-bold">
              <span>
                {ki.order_items?.name_snapshot ?? "item"}
                {ki.order_items?.seat ? (
                  <span className="ml-1 font-normal">(seat {ki.order_items.seat})</span>
                ) : null}
              </span>
              <span>×{ki.qty}</span>
            </div>
            {ki.order_items?.order_item_modifiers?.map((m, i) => (
              <div key={i} className="pl-3 text-xs">
                + {m.name_snapshot}
                {m.qty > 1 ? ` ×${m.qty}` : ""}
              </div>
            ))}
            {ki.order_items?.notes ? (
              <div className="pl-3 text-xs italic">** {ki.order_items.notes}</div>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-2 border-t border-dashed border-black pt-1 text-center text-xs">
        {kot.kot_items.reduce((n, ki) => n + ki.qty, 0)} item(s)
      </div>

      <PrintOnLoad kotId={kot.id} />
    </div>
  )
}
