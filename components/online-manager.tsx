"use client"

import { useState, useTransition } from "react"
import { dispatchDelivery, setOnlineStatus } from "@/app/(app)/online/actions"
import { type OnlineStatus } from "@/lib/online-constants"
import { money, formatDateTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Line = { name_snapshot: string; qty: number; unit_price_cents: number }
type Order = {
  id: string
  fulfillment: string
  status: string
  fee_cents: number
  address: { line?: string } | null
  created_at: string
  customers: { name: string | null; phone: string | null } | null
  orders: { order_items: Line[] } | null
  delivery_tracking: { status: string; driver_name: string | null }[]
}

const STATUS_STYLES: Record<string, string> = {
  received: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  preparing: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  ready: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  out_for_delivery: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  delivered: "bg-green-500/10 text-green-600 dark:text-green-400",
  cancelled: "bg-red-500/10 text-red-600 dark:text-red-400",
}

const NEXT: Record<string, { label: string; status: OnlineStatus }[]> = {
  received: [{ label: "Start", status: "preparing" }, { label: "Cancel", status: "cancelled" }],
  preparing: [{ label: "Ready", status: "ready" }],
  ready: [{ label: "Delivered/Collected", status: "delivered" }],
  out_for_delivery: [{ label: "Delivered", status: "delivered" }],
  delivered: [],
  cancelled: [],
}

export function OnlineManager({
  currency,
  timezone,
  orders,
}: {
  currency: string
  timezone: string
  orders: Order[]
}) {
  const [pending, startTransition] = useTransition()
  const [driver, setDriver] = useState<Record<string, string>>({})

  if (orders.length === 0)
    return <p className="text-sm text-muted-foreground">No online orders yet.</p>

  return (
    <div className="flex flex-col gap-4">
      {orders.map((o) => {
        const lines = o.orders?.order_items ?? []
        const subtotal = lines.reduce((s, l) => s + l.unit_price_cents * l.qty, 0)
        const track = o.delivery_tracking?.[0]
        return (
          <div key={o.id} className="rounded-lg border p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <span className="font-medium capitalize">{o.fulfillment}</span>
                <span className="ml-2 text-sm text-muted-foreground">
                  {o.customers?.name ?? "Guest"}
                  {o.customers?.phone ? ` · ${o.customers.phone}` : ""}
                </span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[o.status] ?? ""}`}>
                {o.status.replace(/_/g, " ")}
              </span>
            </div>
            <p className="mb-1 text-xs text-muted-foreground">{formatDateTime(o.created_at, timezone)}</p>
            {o.address?.line ? (
              <p className="mb-2 text-xs text-muted-foreground">📍 {o.address.line}</p>
            ) : null}
            <ul className="mb-2 text-sm">
              {lines.map((l, i) => (
                <li key={i} className="flex justify-between">
                  <span>{l.qty}× {l.name_snapshot}</span>
                  <span className="text-muted-foreground">{money(l.unit_price_cents * l.qty, currency)}</span>
                </li>
              ))}
              <li className="flex justify-between border-t pt-1 font-medium">
                <span>Total {o.fee_cents > 0 ? `(incl. ${money(o.fee_cents, currency)} fee)` : ""}</span>
                <span>{money(subtotal + o.fee_cents, currency)}</span>
              </li>
            </ul>
            {track ? (
              <p className="mb-2 text-xs text-green-600 dark:text-green-400">
                🚚 {track.status}{track.driver_name ? ` · ${track.driver_name}` : ""}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {(NEXT[o.status] ?? []).map((a) => (
                <Button
                  key={a.status}
                  size="sm"
                  variant={a.status === "cancelled" ? "outline" : "default"}
                  disabled={pending}
                  onClick={() => startTransition(async () => { await setOnlineStatus(o.id, a.status) })}
                >
                  {a.label}
                </Button>
              ))}
              {o.fulfillment === "delivery" && o.status === "ready" ? (
                <>
                  <Input
                    placeholder="Driver"
                    value={driver[o.id] ?? ""}
                    onChange={(e) => setDriver((d) => ({ ...d, [o.id]: e.target.value }))}
                    className="h-8 w-28 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => startTransition(async () => { await dispatchDelivery(o.id, driver[o.id] ?? "") })}
                  >
                    Dispatch
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
