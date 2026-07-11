"use client"

import { useOptimistic, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { addItem, fireOrder, removeItem, type PosState } from "@/app/(app)/pos/actions"
import { generateBill } from "@/app/(app)/bill/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"

type Order = {
  id: string
  status: string
  order_type: string
  restaurant_tables: { label: string } | null
}
type Line = {
  id: string
  name_snapshot: string
  qty: number
  unit_price_cents: number
  status: string
  is_void: boolean
}
type MenuItem = { id: string; name: string; base_price_cents: number; is_86: boolean }

export function PosBuilder({
  currency,
  order,
  items,
  menu,
}: {
  currency: string
  order: Order
  items: Line[]
  menu: MenuItem[]
}) {
  const [pending, startTransition] = useTransition()

  const editable = order.status === "draft" || order.status === "placed"
  const live = items.filter((i) => !i.is_void)

  // Optimistic echo: added/removed lines show instantly; the server revalidate
  // (or the {error} toast) reconciles.
  type OptAction = { type: "add"; item: MenuItem } | { type: "remove"; id: string }
  const [optItems, applyOpt] = useOptimistic(live, (state: Line[], action: OptAction) =>
    action.type === "add"
      ? [
          ...state,
          {
            id: `optimistic-${action.item.id}-${state.length}`,
            name_snapshot: action.item.name,
            qty: 1,
            unit_price_cents: action.item.base_price_cents,
            status: "draft",
            is_void: false,
          },
        ]
      : state.filter((l) => l.id !== action.id),
  )
  const total = optItems.reduce((sum, i) => sum + i.unit_price_cents * i.qty, 0)

  function run(optimistic: OptAction, fn: () => Promise<PosState>) {
    startTransition(async () => {
      applyOpt(optimistic)
      const res = await fn()
      if (res && "error" in res) toast.error(res.error)
    })
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {order.restaurant_tables?.label ? `Table ${order.restaurant_tables.label}` : "Takeaway"}
          </h1>
          <p className="text-sm capitalize text-muted-foreground">
            {order.status.replace("_", " ")}
          </p>
        </div>
        <Button variant="ghost" nativeButton={false} render={<Link href="/pos" />}>
          ← All orders
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
        {/* Menu grid */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Add items</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {menu.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={!editable || m.is_86 || pending}
                onClick={() => run({ type: "add", item: m }, () => addItem(order.id, m.id))}
                className="flex flex-col items-start rounded-lg border p-3 text-left transition hover:bg-accent disabled:opacity-40"
              >
                <span className="text-sm font-medium">{m.name}</span>
                <span className="text-xs text-muted-foreground">
                  {money(m.base_price_cents, currency)}
                  {m.is_86 ? " · 86" : ""}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Running order */}
        <section className="flex flex-col rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-semibold">Order</h2>
          {optItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items yet.</p>
          ) : (
            <ul className="mb-3 space-y-2">
              {optItems.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex-1">
                    {l.qty}× {l.name_snapshot}
                  </span>
                  <span className="text-muted-foreground">
                    {money(l.unit_price_cents * l.qty, currency)}
                  </span>
                  {editable ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run({ type: "remove", id: l.id }, () => removeItem(order.id, l.id))}
                      className="text-xs text-destructive hover:underline"
                    >
                      ✕
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-auto border-t pt-3">
            <div className="mb-3 flex justify-between font-semibold">
              <span>Subtotal</span>
              <span>{money(total, currency)}</span>
            </div>
            {editable ? (
              <Button
                className="w-full"
                disabled={pending || optItems.length === 0}
                onClick={() =>
                  startTransition(async () => {
                    const res = await fireOrder(order.id)
                    if (res && "error" in res) toast.error(res.error)
                  })
                }
              >
                {pending ? "Firing…" : "Fire to kitchen"}
              </Button>
            ) : order.status === "billed" || order.status === "closed" ? (
              <p className="text-center text-sm text-muted-foreground">
                {order.status === "closed" ? "Closed · paid" : "Billed"}
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-center text-sm text-muted-foreground">
                  Fired · {order.status.replace("_", " ")}
                </p>
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => startTransition(async () => { await generateBill(order.id) })}
                >
                  Generate bill
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
