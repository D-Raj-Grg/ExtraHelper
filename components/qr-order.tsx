"use client"

import { useState, useTransition } from "react"
import { placeQrOrder, requestBill, submitFeedback, type QrState } from "@/app/t/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Item = { id: string; name: string; description: string | null; price_cents: number }
type Category = { id: string; name: string; items: Item[] }

export function QrOrder({
  token,
  currency,
  categories,
}: {
  token: string
  currency: string
  categories: Category[]
}) {
  const [cart, setCart] = useState<Record<string, number>>({})
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<QrState>(undefined)
  const [billed, setBilled] = useState(false)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")
  const [thanked, setThanked] = useState(false)

  const items = categories.flatMap((c) => c.items)
  const total = Object.entries(cart).reduce((sum, [id, qty]) => {
    const it = items.find((i) => i.id === id)
    return sum + (it ? it.price_cents * qty : 0)
  }, 0)
  const count = Object.values(cart).reduce((a, b) => a + b, 0)

  function add(id: string) {
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  }
  function remove(id: string) {
    setCart((c) => {
      const n = (c[id] ?? 0) - 1
      const next = { ...c }
      if (n <= 0) delete next[id]
      else next[id] = n
      return next
    })
  }

  function submit() {
    const payload = Object.entries(cart).map(([item_id, qty]) => ({ item_id, qty }))
    startTransition(async () => {
      setState(await placeQrOrder(token, payload))
    })
  }

  if (state && "ok" in state) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-6 text-center">
          <p className="text-lg font-semibold text-green-600 dark:text-green-400">Order placed!</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your order is with the kitchen. A server will confirm shortly.
          </p>
        </div>
        <Button
          className="w-full"
          variant="secondary"
          disabled={pending || billed}
          onClick={() => startTransition(async () => { const r = await requestBill(token); if (r.ok) setBilled(true) })}
        >
          {billed ? "Bill requested ✓" : "Request bill"}
        </Button>

        {thanked ? (
          <p className="text-center text-sm text-green-600 dark:text-green-400">Thanks for the feedback!</p>
        ) : (
          <div className="rounded-lg border p-4">
            <p className="mb-2 text-sm font-medium">Rate your visit</p>
            <div className="mb-2 flex gap-1 text-2xl">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} stars`}>
                  {n <= rating ? "★" : "☆"}
                </button>
              ))}
            </div>
            <Input placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} className="mb-2" />
            <Button
              className="w-full"
              variant="outline"
              disabled={pending || rating === 0}
              onClick={() => startTransition(async () => { const r = await submitFeedback(token, rating, comment); if (r.ok) setThanked(true) })}
            >
              Submit feedback
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="pb-28">
      {categories.map((cat) => (
        <section key={cat.id} className="mb-5">
          <h2 className="mb-2 font-semibold">{cat.name}</h2>
          <div className="flex flex-col gap-2">
            {cat.items.map((it) => (
              <div key={it.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{it.name}</p>
                  {it.description ? (
                    <p className="truncate text-xs text-muted-foreground">{it.description}</p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">{money(it.price_cents, currency)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {cart[it.id] ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => remove(it.id)}>
                        −
                      </Button>
                      <span className="w-5 text-center text-sm font-medium">{cart[it.id]}</span>
                    </>
                  ) : null}
                  <Button size="sm" onClick={() => add(it.id)}>
                    +
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t bg-background p-4">
          {state && "error" in state ? (
            <p className="mb-2 text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <Button className="w-full" disabled={pending} onClick={submit}>
            {pending ? "Placing…" : `Place order · ${count} item${count === 1 ? "" : "s"} · ${money(total, currency)}`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
