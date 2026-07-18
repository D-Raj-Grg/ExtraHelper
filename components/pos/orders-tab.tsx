"use client"

import { useState } from "react"

import { orderTypeLabel } from "@/lib/order-constants"
import { ChoiceChip } from "@/components/pos/choice-chip"
import { OrderCard } from "@/components/pos/order-card"
import { PosEmptyState } from "@/components/pos/pos-empty-state"
import type { PosOrderCard } from "@/components/pos/types"

const ALL = "__all__"

/**
 * The active-order board, grouped by destination. A chip row filters to one
 * order_type; below it, cards sit under a section header per type so "Table 3"
 * reads in the context of dine-in vs takeaway. The chips are a real radio group
 * (arrow keys, screen-reader state) via ChoiceChip.
 */
export function OrdersTab({
  orders,
  currency,
  timeZone,
  menuEmpty,
  online,
  onOpen,
  onNew,
}: {
  orders: PosOrderCard[]
  currency: string
  timeZone: string
  menuEmpty: boolean
  online: boolean
  onOpen: (orderId: string) => void
  onNew: () => void
}) {
  const [filter, setFilter] = useState<string>(ALL)

  if (orders.length === 0) {
    return <PosEmptyState onNew={onNew} menuEmpty={menuEmpty} online={online} />
  }

  // Group by destination, preserving first-seen order so the chip row and the
  // sections agree on ordering.
  const groups = new Map<string, PosOrderCard[]>()
  for (const o of orders) {
    const list = groups.get(o.order_type)
    if (list) list.push(o)
    else groups.set(o.order_type, [o])
  }
  const types = [...groups.keys()]

  // A filter pointing at a type that just emptied (last order billed) falls back
  // to All rather than showing a blank pane.
  const active = filter !== ALL && groups.has(filter) ? filter : ALL
  const shown = active === ALL ? types : [active]

  return (
    <div className="space-y-5">
      <div
        role="radiogroup"
        aria-label="Filter by destination"
        className="flex flex-wrap gap-2"
      >
        <ChoiceChip
          name="pos-orders-filter"
          checked={active === ALL}
          onSelect={() => setFilter(ALL)}
          label="All"
          detail={`${orders.length} ${orders.length === 1 ? "order" : "orders"}`}
        />
        {types.map((t) => {
          const count = groups.get(t)?.length ?? 0
          return (
            <ChoiceChip
              key={t}
              name="pos-orders-filter"
              checked={active === t}
              onSelect={() => setFilter(t)}
              label={orderTypeLabel(t)}
              detail={`${count} ${count === 1 ? "order" : "orders"}`}
            />
          )
        })}
      </div>

      {shown.map((t) => (
        <section key={t}>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            {orderTypeLabel(t)}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(groups.get(t) ?? []).map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                currency={currency}
                timeZone={timeZone}
                onOpen={() => onOpen(o.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
