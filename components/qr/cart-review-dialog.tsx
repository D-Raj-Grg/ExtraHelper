"use client"

import { MinusIcon, PlusIcon, TicketIcon, Trash2Icon, XIcon } from "lucide-react"

import { money } from "@/lib/format"
import type { CouponPreview } from "@/lib/coupon-constants"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cartTotal, type QrCartLine } from "@/components/qr/qr-menu-types"

/**
 * The order before it's sent.
 *
 * A guest adding fifteen dishes down a long menu has no way to see what they
 * have picked without scrolling back through it — so the summary bar opens
 * this, where each line can be corrected in place. A coupon (typed, or carried
 * in from a flyer link) is checked here too, so the deal is visible before the
 * order goes.
 */
export function CartReviewDialog({
  lines,
  currency,
  open,
  onOpenChange,
  onSetQty,
  pending,
  error,
  onPlace,
  coupon,
  onCouponChange,
  couponPreview,
  couponError,
  checkingCoupon,
  onCheckCoupon,
  onClearCoupon,
  discountCents,
}: {
  lines: QrCartLine[]
  currency: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSetQty: (key: string, qty: number) => void
  pending: boolean
  error?: string | null
  onPlace: () => void
  /** What the guest typed (or the flyer carried). */
  coupon: string
  onCouponChange: (code: string) => void
  /** The server's answer for `coupon`, once checked. */
  couponPreview: CouponPreview | null
  couponError: string | null
  checkingCoupon: boolean
  onCheckCoupon: () => void
  onClearCoupon: () => void
  /** The previewed coupon against the cart as it stands now. */
  discountCents: number
}) {
  const total = cartTotal(lines)
  const net = Math.max(0, total - discountCents)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Your order</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <ul className="divide-y">
            {lines.map((l) => (
              <li key={l.key} className="flex items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug font-medium">{l.label}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {money(l.unitPriceCents, currency)} each
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="outline"
                  className="size-11"
                  onClick={() => onSetQty(l.key, l.qty - 1)}
                  aria-label={l.qty === 1 ? `Remove ${l.label}` : `One fewer ${l.label}`}
                >
                  {l.qty === 1 ? <Trash2Icon /> : <MinusIcon />}
                </Button>
                <span className="w-6 text-center font-semibold tabular-nums">{l.qty}</span>
                <Button
                  size="icon"
                  variant="outline"
                  className="size-11"
                  disabled={l.qty >= 20}
                  onClick={() => onSetQty(l.key, l.qty + 1)}
                  aria-label={`One more ${l.label}`}
                >
                  <PlusIcon />
                </Button>
                <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">
                  {money(l.unitPriceCents * l.qty, currency)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-3 border-t pt-3">
            {couponPreview ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                  <TicketIcon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">
                    <span className="font-semibold">{couponPreview.code}</span>
                    {couponPreview.name ? ` · ${couponPreview.name}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    −{money(discountCents, currency)}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-11"
                    onClick={onClearCoupon}
                    aria-label={`Remove coupon ${couponPreview.code}`}
                  >
                    <XIcon />
                  </Button>
                </span>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <Field className="min-w-0 flex-1">
                  <FieldLabel htmlFor="qr-coupon">Coupon code</FieldLabel>
                  <Input
                    id="qr-coupon"
                    className="h-11 uppercase"
                    placeholder="CODE"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    value={coupon}
                    onChange={(e) => onCouponChange(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && coupon.trim()) {
                        e.preventDefault()
                        onCheckCoupon()
                      }
                    }}
                    aria-describedby={couponError ? "qr-coupon-error" : undefined}
                  />
                </Field>
                <Button
                  variant="secondary"
                  className="h-11"
                  disabled={checkingCoupon || !coupon.trim()}
                  onClick={onCheckCoupon}
                >
                  <TicketIcon className="size-4" />
                  {checkingCoupon ? "Checking…" : "Apply"}
                </Button>
              </div>
            )}
            {couponError ? (
              <p id="qr-coupon-error" className="mt-1 text-sm text-destructive" role="alert">
                {couponError}
              </p>
            ) : null}
          </div>
        </DialogBody>

        <DialogFooter className="flex-col gap-2">
          {error ? (
            <p className="w-full text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex w-full items-center justify-between text-base font-semibold tabular-nums">
            <span>Total</span>
            <span>
              {discountCents > 0 ? (
                <span className="mr-2 text-sm font-normal text-muted-foreground line-through">
                  {money(total, currency)}
                </span>
              ) : null}
              {money(net, currency)}
            </span>
          </div>
          <p className="w-full text-xs text-muted-foreground">
            Taxes and charges, if any, are added to your final bill.
          </p>
          <Button
            className="h-16 w-full text-base font-semibold"
            disabled={pending || lines.length === 0}
            onClick={onPlace}
          >
            {pending ? "Sending to kitchen…" : "Send to kitchen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
