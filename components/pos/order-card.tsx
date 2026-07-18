"use client"

import { ArmchairIcon, ShoppingBagIcon, UsersIcon } from "lucide-react"

import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { orderStatusLabel, orderTypeLabel, ORDER_STATUS_STYLE } from "@/lib/order-constants"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { RelativeTime } from "@/components/pos/relative-time"
import type { PosOrderCard } from "@/components/pos/types"

/** How many lines to show before collapsing the rest into a count. */
const MAX_LINES = 4

/**
 * One active order. The whole card is the target — a waiter shouldn't have to
 * hit a small "Open" button mid-service.
 */
export function OrderCard({
  order,
  currency,
  timeZone,
  onOpen,
}: {
  order: PosOrderCard
  currency: string
  timeZone: string
  onOpen: () => void
}) {
  const lines = (order.order_items ?? []).filter((l) => !l.is_void)
  const dishes = lines.reduce((sum, l) => sum + l.qty, 0)
  const total = lines.reduce((sum, l) => sum + l.unit_price_cents * l.qty, 0)
  const shown = lines.slice(0, MAX_LINES)
  const rest = lines.length - shown.length

  // "New" means nothing has been fired yet — the only reading that's true.
  // Deriving it from a time window would call a 20-minute-old untouched order
  // stale when it's still waiting on the waiter.
  const isNew = order.status === "draft"
  const isTakeaway = !order.restaurant_tables
  const label = order.restaurant_tables?.label ? `Table ${order.restaurant_tables.label}` : "Takeaway"

  return (
    // The button fills the card rather than sitting inside it: the whole card is
    // the target, and there's still only one border depth.
    <Card className="p-0 transition-[box-shadow,transform] duration-150 ease-out has-[:hover]:ring-ring/40 has-[:active]:scale-[0.99] motion-reduce:transition-none motion-reduce:has-[:active]:scale-100">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${label} order · ${dishes} ${dishes === 1 ? "dish" : "dishes"} · ${money(total, currency)}`}
        className="flex h-full w-full flex-col gap-3 rounded-xl p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{label}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isTakeaway ? (
              <ShoppingBagIcon className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <ArmchairIcon className="size-3.5 shrink-0" aria-hidden />
            )}
            {orderTypeLabel(order.order_type)}
            {order.guests ? (
              <>
                <span aria-hidden>·</span>
                <UsersIcon className="size-3.5 shrink-0" aria-hidden />
                <span className="tabular-nums">{order.guests}</span>
                <span className="sr-only">guests</span>
              </>
            ) : null}
          </p>
        </div>
        {isNew ? (
          <Badge className="shrink-0 border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            New
          </Badge>
        ) : (
          <Badge
            className={cn("shrink-0 border-transparent", ORDER_STATUS_STYLE[order.status])}
          >
            {orderStatusLabel(order.status)}
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        <RelativeTime iso={order.created_at} timeZone={timeZone} />
      </p>

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No dishes yet — tap to add some.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {shown.map((l) => (
            <li key={l.id} className="flex justify-between gap-2">
              <span className="truncate">{l.name_snapshot}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{l.qty}</span>
            </li>
          ))}
          {rest > 0 ? (
            <li className="text-xs text-muted-foreground">+{rest} more</li>
          ) : null}
        </ul>
      )}

      <div className="mt-auto flex items-baseline justify-between gap-2 border-t pt-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {dishes} {dishes === 1 ? "dish" : "dishes"}
        </span>
        <span className="text-base font-bold tabular-nums">{money(total, currency)}</span>
      </div>
      </button>
    </Card>
  )
}
