"use client"

import { useState } from "react"
import { PlusIcon, ShoppingCartIcon } from "lucide-react"

import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { CartLineRow } from "@/components/pos/cart-line-row"
import { CustomItemDialog } from "@/components/pos/custom-item-dialog"
import { CheckInDetails, type CheckIn } from "@/components/pos/check-in-details"
import type { CartController } from "@/components/pos/cart-types"
import type { PosCustomer, PosStaff } from "@/components/pos/types"

/**
 * The cart column: what's being ordered, plus who it's for.
 *
 * Not a Card — it already sits inside the modal, which reads as the surface.
 * A card here would be a card in a card.
 */
export function CartRail({
  cart,
  currency,
  checkIn,
  onCheckInChange,
  customers,
  staff,
  showGuests,
}: {
  cart: CartController
  currency: string
  checkIn: CheckIn
  onCheckInChange: (next: CheckIn) => void
  customers: PosCustomer[]
  staff: PosStaff[]
  showGuests: boolean
}) {
  const [customOpen, setCustomOpen] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b p-3">
        <h2 className="text-sm font-semibold">Cart items</h2>
        <Button variant="outline" size="sm" onClick={() => setCustomOpen(true)} disabled={cart.busy}>
          <PlusIcon />
          Custom item
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {cart.lines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <ShoppingCartIcon className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Nothing in the order yet</p>
            <p className="text-sm text-muted-foreground">
              Tap a dish on the left to add it. Dishes with sizes or add-ons will ask first.
            </p>
          </div>
        ) : (
          <ul>
            {cart.lines.map((line) => (
              // Keyed by lineId — never by content. A signature key would
              // remount this row on every keystroke in its remarks field.
              <CartLineRow key={line.lineId} line={line} cart={cart} currency={currency} />
            ))}
          </ul>
        )}

        <div className="border-t p-3">
          <CheckInDetails
            value={checkIn}
            onChange={onCheckInChange}
            customers={customers}
            staff={staff}
            disabled={cart.busy}
            showGuests={showGuests}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t p-3">
        <span className="text-sm font-semibold">Total</span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {cart.dishCount} {cart.dishCount === 1 ? "dish" : "dishes"}
        </span>
        <span className="text-lg font-bold tabular-nums">{money(cart.totalCents, currency)}</span>
      </div>

      <CustomItemDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        currency={currency}
        onAdd={cart.add}
      />
    </div>
  )
}
