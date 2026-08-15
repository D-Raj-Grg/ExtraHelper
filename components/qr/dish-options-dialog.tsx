"use client"

import { useState } from "react"
import { MinusIcon, PlusIcon } from "lucide-react"

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
import { ChoiceChip } from "@/components/pos/choice-chip"
import { DishThumb } from "@/components/pos/dish-thumb"
import { VegMark } from "@/components/pos/veg-mark"
import { variantPrice, type QrItem } from "@/components/qr/qr-menu-types"

/**
 * Size picker for a dish that has variants.
 *
 * Guests could not pick a size at all before this: `place_qr_order` took an
 * item and a qty, so a "Buff Sekuwa" ordered from the phone became the base
 * price — zero, for most of them. Each chip quotes the price it costs, so the
 * choice is priced before it's made, not after.
 */
export function DishOptionsDialog({
  item,
  currency,
  open,
  onOpenChange,
  onAdd,
}: {
  item: QrItem | null
  currency: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (variantId: string | null, qty: number) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        {/* Keyed so opening a different dish resets the size and qty rather
            than carrying the last dish's choice across. */}
        {item ? (
          <OptionsForm
            key={item.id}
            item={item}
            currency={currency}
            onAdd={(variantId, qty) => {
              onAdd(variantId, qty)
              onOpenChange(false)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function OptionsForm({
  item,
  currency,
  onAdd,
}: {
  item: QrItem
  currency: string
  onAdd: (variantId: string | null, qty: number) => void
}) {
  const variants = item.variants ?? []
  const [variantId, setVariantId] = useState<string | null>(variants[0]?.id ?? null)
  const [qty, setQty] = useState(1)

  const unit = variantPrice(item, variantId)

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-start gap-2 pr-8">
          <VegMark isVeg={item.is_veg} className="mt-1.5" />
          <span className="min-w-0">{item.name}</span>
        </DialogTitle>
      </DialogHeader>

      <DialogBody className="space-y-4">
        <div className="flex gap-3">
          <span className="block size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
            <DishThumb item={item} monogramClassName="text-xl" />
          </span>
          {item.description ? (
            <p className="text-sm text-muted-foreground">{item.description}</p>
          ) : null}
        </div>

        {variants.length > 0 ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Choose a size</legend>
            <div className="flex flex-wrap gap-2">
              {variants.map((v) => (
                <ChoiceChip
                  key={v.id}
                  name="qr-variant"
                  checked={variantId === v.id}
                  onSelect={() => setVariantId(v.id)}
                  label={v.name}
                  detail={money(item.price_cents + v.price_delta_cents, currency)}
                  showCheck
                />
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">How many?</span>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              className="size-11"
              disabled={qty <= 1}
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              aria-label="One fewer"
            >
              <MinusIcon />
            </Button>
            <span className="w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">
              {qty}
            </span>
            <Button
              size="icon"
              variant="outline"
              className="size-11"
              disabled={qty >= 20}
              onClick={() => setQty((q) => Math.min(20, q + 1))}
              aria-label="One more"
            >
              <PlusIcon />
            </Button>
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button className="w-full" onClick={() => onAdd(variantId, qty)}>
          Add to order · {money(unit * qty, currency)}
        </Button>
      </DialogFooter>
    </>
  )
}
