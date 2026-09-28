"use client"

import { useState, useTransition } from "react"
import { TicketIcon, XIcon } from "lucide-react"

import { placeOnlineOrder, previewCoupon, type StoreState } from "@/app/s/actions"
import { payForOrder, quoteOrder, type PayState } from "@/app/pay/actions"
import { extractCouponCode, type CouponPreview } from "@/lib/coupon-constants"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { VegMark } from "@/components/pos/veg-mark"

type Item = { id: string; name: string; description: string | null; price_cents: number; is_veg: boolean | null }
type Category = { id: string; name: string; items: Item[] }

/** The previewed coupon against the cart as it stands; the server decides at placement. */
function previewDiscount(preview: CouponPreview | null, subtotalCents: number): number {
  if (!preview) return 0
  if (subtotalCents < preview.min_subtotal_cents) return 0
  const raw =
    preview.type === "percent"
      ? Math.round((subtotalCents * preview.value) / 100)
      : Math.round(preview.value * 100)
  return Math.min(raw, subtotalCents)
}

export function Storefront({
  slug,
  currency,
  fees,
  categories,
  initialCoupon = null,
}: {
  slug: string
  currency: string
  fees: Record<string, number>
  categories: Category[]
  /** A code carried in from a flyer link (`?coupon=`), already normalised. */
  initialCoupon?: string | null
}) {
  const [cart, setCart] = useState<Record<string, number>>({})
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("pickup")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<StoreState>(undefined)
  const [pay, setPay] = useState<PayState | null>(null)
  // The server's due figure once the order exists; the bar's estimate until then.
  const [placedDue, setPlacedDue] = useState<number | null>(null)
  const [coupon, setCoupon] = useState(initialCoupon ?? "")
  const [couponPreview, setCouponPreview] = useState<CouponPreview | null>(null)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [checkingCoupon, startCouponCheck] = useTransition()

  const items = categories.flatMap((c) => c.items)
  const subtotal = Object.entries(cart).reduce((s, [id, q]) => {
    const it = items.find((i) => i.id === id)
    return s + (it ? it.price_cents * q : 0)
  }, 0)
  const feeCents = Math.round((Number(fees[fulfillment]) || 0) * 100)
  const discountCents = previewDiscount(couponPreview, subtotal)
  const total = Math.max(0, subtotal - discountCents) + feeCents
  const count = Object.values(cart).reduce((a, b) => a + b, 0)

  function checkCoupon() {
    const code = extractCouponCode(coupon)
    if (!code) {
      setCouponError("That coupon code isn't valid")
      return
    }
    startCouponCheck(async () => {
      setCouponError(null)
      const r = await previewCoupon(slug, code, subtotal, fulfillment)
      if ("error" in r) {
        setCouponPreview(null)
        setCouponError(r.error)
      } else {
        setCoupon(r.code)
        setCouponPreview(r)
      }
    })
  }

  function clearCoupon() {
    setCoupon("")
    setCouponPreview(null)
    setCouponError(null)
  }

  function submit() {
    const payload = Object.entries(cart).map(([item_id, qty]) => ({ item_id, qty }))
    const code = coupon.trim() ? extractCouponCode(coupon) : null
    if (coupon.trim() && !code) {
      setCouponError("That coupon code isn't valid")
      return
    }
    startTransition(async () => {
      const result = await placeOnlineOrder(slug, payload, fulfillment, { name, phone, address }, code)
      if (result && "ok" in result) {
        const quote = await quoteOrder(result.orderId)
        setPlacedDue(quote ? quote.due : null)
      }
      setState(result)
    })
  }

  if (state && "ok" in state) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-6 text-center">
          <p className="text-lg font-semibold text-green-600 dark:text-green-400">Order received!</p>
          <p className="mt-1 text-sm text-muted-foreground">
            We&apos;ll start preparing your {fulfillment} order.
          </p>
        </div>
        {pay && "ok" in pay && pay.status === "paid" ? (
          <p className="text-center text-sm font-medium text-green-600 dark:text-green-400">
            Paid ✓ — thanks!
          </p>
        ) : pay && "ok" in pay ? (
          <p className="text-center text-sm text-muted-foreground">Payment processing…</p>
        ) : (
          <div className="space-y-2">
            {pay && "error" in pay ? (
              <p className="text-sm text-destructive" role="alert">{pay.error}</p>
            ) : null}
            <Button
              className="w-full"
              disabled={pending}
              onClick={() => startTransition(async () => setPay(await payForOrder(state.orderId)))}
            >
              {pending ? "Processing…" : `Pay now (prepay) · ${money(placedDue ?? total, currency)}`}
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="pb-72">
      {coupon.trim() && count === 0 ? (
        <p className="mb-3 flex items-center justify-center gap-1.5 rounded-lg border bg-muted/40 px-3 py-2 text-center text-sm">
          <TicketIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            Coupon <span className="font-semibold">{coupon.trim().toUpperCase()}</span> will be applied
            at checkout
          </span>
        </p>
      ) : null}
      {categories.map((cat) => (
        <section key={cat.id} className="mb-5">
          <h2 className="mb-2 font-semibold">{cat.name}</h2>
          <div className="flex flex-col gap-2">
            {cat.items.map((it) => (
              <div key={it.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-medium">
                    <VegMark isVeg={it.is_veg} />
                    {it.name}
                  </p>
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
              <Button
                key={f}
                type="button"
                variant={fulfillment === f ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  setFulfillment(f)
                  // The rules can differ per order type: check again.
                  if (couponPreview) setCouponPreview(null)
                }}
                className="flex-1 capitalize"
              >
                {f}
                {fees[f] ? ` +${money(Math.round(Number(fees[f]) * 100), currency)}` : ""}
              </Button>
            ))}
          </div>
          <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {fulfillment === "delivery" ? (
            <Input placeholder="Delivery address" value={address} onChange={(e) => setAddress(e.target.value)} />
          ) : null}

          {couponPreview ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <TicketIcon className="size-4 shrink-0" aria-hidden />
                <span className="truncate font-semibold">{couponPreview.code}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  −{money(discountCents, currency)}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-11"
                  onClick={clearCoupon}
                  aria-label={`Remove coupon ${couponPreview.code}`}
                >
                  <XIcon />
                </Button>
              </span>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <Input
                aria-label="Coupon code"
                className="h-11 uppercase"
                placeholder="Coupon code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                value={coupon}
                onChange={(e) => {
                  setCoupon(e.target.value.toUpperCase())
                  setCouponError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && coupon.trim()) {
                    e.preventDefault()
                    checkCoupon()
                  }
                }}
              />
              <Button
                variant="secondary"
                className="h-11"
                disabled={checkingCoupon || !coupon.trim()}
                onClick={checkCoupon}
              >
                <TicketIcon className="size-4" />
                {checkingCoupon ? "Checking…" : "Apply"}
              </Button>
            </div>
          )}
          {couponError ? (
            <p className="text-sm text-destructive" role="alert">{couponError}</p>
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
