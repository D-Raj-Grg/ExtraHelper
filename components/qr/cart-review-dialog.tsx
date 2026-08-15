"use client"

import { MinusIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cartTotal, type QrCartLine } from "@/components/qr/qr-menu-types"

/**
 * The order before it's sent.
 *
 * A guest adding fifteen dishes down a long menu has no way to see what they
 * have picked without scrolling back through it — so the summary bar opens
 * this, where each line can be corrected in place.
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
}: {
  lines: QrCartLine[]
  currency: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSetQty: (key: string, qty: number) => void
  pending: boolean
  error?: string | null
  onPlace: () => void
}) {
  const total = cartTotal(lines)

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
        </DialogBody>

        <DialogFooter className="flex-col gap-2">
          {error ? (
            <p className="w-full text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex w-full items-center justify-between text-base font-semibold tabular-nums">
            <span>Total</span>
            <span>{money(total, currency)}</span>
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
