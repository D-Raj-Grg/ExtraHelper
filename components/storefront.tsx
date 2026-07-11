"use client"

import { useState, useTransition } from "react"
import { placeOnlineOrder, type StoreState } from "@/app/s/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Item = { id: string; name: string; description: string | null; price_cents: number }
type Category = { id: string; name: string; items: Item[] }

export function Storefront({
  slug,
  currency,
  fees,
  categories,
}: {
  slug: string
  currency: string
  fees: Record<string, number>
  categories: Category[]
}) {
  const [cart, setCart] = useState<Record<string, number>>({})
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("pickup")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<StoreState>(undefined)

  const items = categories.flatMap((c) => c.items)
  const subtotal = Object.entries(cart).reduce((s, [id, q]) => {
    const it = items.find((i) => i.id === id)
    return s + (it ? it.price_cents * q : 0)
  }, 0)
  const feeCents = Math.round((Number(fees[fulfillment]) || 0) * 100)
  const total = subtotal + feeCents
  const count = Object.values(cart).reduce((a, b) => a + b, 0)

  function submit() {
    const payload = Object.entries(cart).map(([item_id, qty]) => ({ item_id, qty }))
    startTransition(async () => {
      setState(await placeOnlineOrder(slug, payload, fulfillment, { name, phone, address }))
    })
  }

  if (state && "ok" in state) {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-6 text-center">
        <p className="text-lg font-semibold text-green-600 dark:text-green-400">Order received!</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ll start preparing your {fulfillment} order.
        </p>
      </div>
    )
  }

  return (
    <div className="pb-64">
      {categories.map((cat) => (
        <section key={cat.id} className="mb-5">
          <h2 className="mb-2 font-semibold">{cat.name}</h2>
          <div className="flex flex-col gap-2">
            {cat.items.map((it) => (
              <div key={it.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{it.name}</p>
                  <p className="text-sm text-muted-foreground">{money(it.price_cents, currency)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {cart[it.id] ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setCart((c) => { const n = (c[it.id] ?? 0) - 1; const x = { ...c }; if (n <= 0) delete x[it.id]; else x[it.id] = n; return x })}>
                        −
                      </Button>
                      <span className="w-5 text-center text-sm font-medium">{cart[it.id]}</span>
                    </>
                  ) : null}
                  <Button size="sm" onClick={() => setCart((c) => ({ ...c, [it.id]: (c[it.id] ?? 0) + 1 }))}>
                    +
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md space-y-2 border-t bg-background p-4">
          <div className="flex gap-2">
            {(["pickup", "delivery"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFulfillment(f)}
                className={`flex-1 rounded-md border px-2 py-1 text-sm capitalize ${
                  fulfillment === f ? "border-primary bg-primary/10 font-medium" : ""
                }`}
              >
                {f}
                {fees[f] ? ` +${money(Math.round(Number(fees[f]) * 100), currency)}` : ""}
              </button>
            ))}
          </div>
          <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {fulfillment === "delivery" ? (
            <Input placeholder="Delivery address" value={address} onChange={(e) => setAddress(e.target.value)} />
          ) : null}
          {state && "error" in state ? (
            <p className="text-sm text-destructive" role="alert">{state.error}</p>
          ) : null}
          <Button className="w-full" disabled={pending} onClick={submit}>
            {pending ? "Placing…" : `Place ${fulfillment} order · ${money(total, currency)}`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
