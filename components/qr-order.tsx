"use client"

import { useState, useTransition } from "react"
import { CheckCircle2Icon, StarIcon, TicketIcon } from "lucide-react"

import { placeQrOrder, previewCoupon, requestBill, submitFeedback, type QrState } from "@/app/t/actions"
import { payForOrder, quoteOrder, type PayState } from "@/app/pay/actions"
import { extractCouponCode, type CouponPreview } from "@/lib/coupon-constants"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CartReviewDialog } from "@/components/qr/cart-review-dialog"
import { MenuBrowser } from "@/components/qr/menu-browser"
import {
  cartTotal,
  lineKey,
  variantPrice,
  type QrCartLine,
  type QrCategory,
  type QrItem,
} from "@/components/qr/qr-menu-types"

/**
 * What a previewed coupon takes off the cart as it stands now. Mirrors the
 * server's bill-level maths so the figure moves with the cart; the server
 * still decides at placement.
 */
function previewDiscount(preview: CouponPreview | null, subtotalCents: number): number {
  if (!preview) return 0
  if (subtotalCents < preview.min_subtotal_cents) return 0
  const raw =
    preview.type === "percent"
      ? Math.round((subtotalCents * preview.value) / 100)
      : Math.round(preview.value * 100)
  return Math.min(raw, subtotalCents)
}

export function QrOrder({
  token,
  currency,
  categories,
  initialCoupon = null,
}: {
  token: string
  currency: string
  categories: QrCategory[]
  /** A code carried in from a flyer link (`?coupon=`), already normalised. */
  initialCoupon?: string | null
}) {
  const [lines, setLines] = useState<QrCartLine[]>([])
  const [reviewing, setReviewing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<QrState>(undefined)
  const [placedTotal, setPlacedTotal] = useState(0)
  const [billed, setBilled] = useState(false)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")
  const [thanked, setThanked] = useState(false)
  const [pay, setPay] = useState<PayState | null>(null)

  // The coupon lives here, not in the dialog: it has to survive the dialog
  // closing and reach the placement call.
  const [coupon, setCoupon] = useState(initialCoupon ?? "")
  const [couponPreview, setCouponPreview] = useState<CouponPreview | null>(null)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [checkingCoupon, startCouponCheck] = useTransition()

  function add(item: QrItem, variantId: string | null, qty: number) {
    const key = lineKey(item.id, variantId)
    const variant = (item.variants ?? []).find((v) => v.id === variantId)
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key)
      // Same dish at the same size merges into one line — two "Gorkha Beer ×1"
      // rows is a list to reconcile, not an order to read.
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, qty: Math.min(20, l.qty + qty) } : l))
      }
      return [
        ...prev,
        {
          key,
          itemId: item.id,
          variantId,
          label: variant ? `${item.name} · ${variant.name}` : item.name,
          unitPriceCents: variantPrice(item, variantId),
          qty: Math.min(20, qty),
        },
      ]
    })
  }

  function setQty(key: string, qty: number) {
    setLines((prev) =>
      qty <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, qty } : l)),
    )
  }

  function checkCoupon() {
    const code = extractCouponCode(coupon)
    if (!code) {
      setCouponError("That coupon code isn't valid")
      return
    }
    startCouponCheck(async () => {
      setCouponError(null)
      const r = await previewCoupon(token, code, cartTotal(lines))
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

  const discountCents = previewDiscount(couponPreview, cartTotal(lines))

  function submit() {
    const payload = lines.map((l) => ({ item_id: l.itemId, variant_id: l.variantId, qty: l.qty }))
    const total = cartTotal(lines)
    // A typed code that was never checked still goes: the server judges it,
    // and a bad one fails the placement with a sentence the guest can fix.
    const code = coupon.trim() ? extractCouponCode(coupon) : null
    if (coupon.trim() && !code) {
      setCouponError("That coupon code isn't valid")
      return
    }
    startTransition(async () => {
      const result = await placeQrOrder(token, payload, code)
      setState(result)
      if (result && "ok" in result) {
        // The server's figure: a code typed but never checked is applied
        // there, and that is what Pay now will charge. The estimate is the
        // fallback if the quote can't be read.
        const quote = await quoteOrder(result.orderId)
        setPlacedTotal(quote ? quote.due : total - discountCents)
        setLines([])
        setReviewing(false)
        // One coupon per visit: round two starts without it.
        clearCoupon()
      }
    })
  }

  if (state && "ok" in state) {
    const orderId = state.orderId
    return (
      <div className="space-y-4 pb-6">
        <div className="rounded-xl border-2 border-emerald-600/30 bg-emerald-500/5 p-6 text-center dark:border-emerald-500/30">
          <CheckCircle2Icon
            aria-hidden
            className="mx-auto mb-2 size-8 text-emerald-600 dark:text-emerald-400"
          />
          <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">Order sent to the kitchen</p>
          <p className="mt-1 text-sm text-muted-foreground">
            A server will bring it over and confirm. Ordered:{" "}
            <span className="font-medium tabular-nums text-foreground">{money(placedTotal, currency)}</span>
          </p>
        </div>

        {pay && "ok" in pay && pay.status === "paid" ? (
          <p className="text-center text-sm font-medium text-emerald-600 dark:text-emerald-400">
            Paid — thank you!
          </p>
        ) : pay && "ok" in pay ? (
          <p className="text-center text-sm text-muted-foreground">Payment processing…</p>
        ) : (
          <div className="space-y-2">
            {pay && "error" in pay ? (
              <p className="text-sm text-destructive" role="alert">
                {pay.error}
              </p>
            ) : null}
            <Button
              className="h-12 w-full"
              disabled={pending}
              onClick={() => startTransition(async () => setPay(await payForOrder(orderId)))}
            >
              {pending ? "Processing…" : `Pay now · ${money(placedTotal, currency)}`}
            </Button>
          </div>
        )}

        {/* Dine-in is rounds, not one basket: the second round is the normal
            case, so it gets a button rather than a page reload. */}
        <Button
          className="h-12 w-full"
          variant="outline"
          onClick={() => {
            setState(undefined)
            setPay(null)
          }}
        >
          Order more
        </Button>

        <Button
          className="h-12 w-full"
          variant="secondary"
          disabled={pending || billed}
          onClick={() =>
            startTransition(async () => {
              const r = await requestBill(token)
              if (r.ok) setBilled(true)
            })
          }
        >
          {billed ? "Bill requested" : "Request the bill"}
        </Button>

        {thanked ? (
          <p className="text-center text-sm text-emerald-600 dark:text-emerald-400">
            Thanks for the feedback!
          </p>
        ) : (
          <div className="rounded-xl border p-4">
            <p className="mb-2 text-sm font-medium">Rate your visit</p>
            <div className="mb-3 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  aria-pressed={n <= rating}
                  aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
                  className="flex size-11 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <StarIcon
                    className={cn(
                      "size-7",
                      n <= rating ? "fill-amber-400 text-amber-500" : "text-muted-foreground/50",
                    )}
                  />
                </button>
              ))}
            </div>
            <Input
              placeholder="Anything you'd like us to know? (optional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="mb-2 h-11"
            />
            <Button
              className="h-12 w-full"
              variant="outline"
              disabled={pending || rating === 0}
              onClick={() =>
                startTransition(async () => {
                  const r = await submitFeedback(token, rating, comment)
                  if (r.ok) setThanked(true)
                })
              }
            >
              Send feedback
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {coupon.trim() ? (
        // A flyer guest should see their code was noticed before they reach
        // the review step, not wonder whether the link worked.
        <div className="mb-2 flex justify-center">
          <Badge variant="secondary" className="h-auto py-1">
            <TicketIcon aria-hidden />
            <span className="font-semibold">{coupon.trim().toUpperCase()}</span>
            <span className="font-normal">
              {couponPreview ? " applied at checkout" : " will be checked at checkout"}
            </span>
          </Badge>
        </div>
      ) : null}
      <MenuBrowser
        categories={categories}
        currency={currency}
        lines={lines}
        onAdd={add}
        onSetQty={setQty}
        onReview={() => setReviewing(true)}
      />
      <CartReviewDialog
        lines={lines}
        currency={currency}
        open={reviewing && lines.length > 0}
        onOpenChange={setReviewing}
        onSetQty={setQty}
        pending={pending}
        error={state && "error" in state ? state.error : null}
        onPlace={submit}
        coupon={coupon}
        onCouponChange={(c) => {
          setCoupon(c)
          setCouponPreview(null)
          setCouponError(null)
        }}
        couponPreview={couponPreview}
        couponError={couponError}
        checkingCoupon={checkingCoupon}
        onCheckCoupon={checkCoupon}
        onClearCoupon={clearCoupon}
        discountCents={discountCents}
      />
    </>
  )
}
