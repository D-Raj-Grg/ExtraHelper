"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DialogDescription } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { QtyStepper } from "@/components/pos/item-options-dialog"
import type { NewLineDraft } from "@/components/pos/cart-types"

/** Mirrors the clamp in place_staff_order and addCustomItem. */
const MAX_PRICE_MAJOR = 100_000

/**
 * An off-menu line — a plating charge, a special the kitchen ran today.
 *
 * This is the one place a price is typed rather than looked up, so the value is
 * checked here for the waiter's sake and again on the server for everyone
 * else's. The line carries no item_id, so it can never stand in for a menu
 * item's price, and it deducts no stock.
 */
export function CustomItemDialog({
  open,
  onOpenChange,
  currency,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: string
  onAdd: (draft: NewLineDraft) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        {/* Keyed on `open` so each visit starts blank rather than showing the
            last custom item still filled in. */}
        <CustomItemForm
          key={String(open)}
          currency={currency}
          onAdd={(draft) => {
            onAdd(draft)
            onOpenChange(false)
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function CustomItemForm({
  currency,
  onAdd,
  onCancel,
}: {
  currency: string
  onAdd: (draft: NewLineDraft) => void
  onCancel: () => void
}) {
  const [name, setName] = useState("")
  const [price, setPrice] = useState("")
  const [qty, setQty] = useState(1)

  const priceNum = Number(price)
  const priceValid = price !== "" && Number.isFinite(priceNum) && priceNum >= 0 && priceNum <= MAX_PRICE_MAJOR
  const nameValid = name.trim().length > 0
  const error =
    price !== "" && !priceValid
      ? `Enter an amount between 0 and ${MAX_PRICE_MAJOR.toLocaleString("en-US")}.`
      : null

  const submit = () => {
    if (!nameValid || !priceValid) return
    onAdd({
      itemId: null,
      name: name.trim(),
      variantId: null,
      variantName: null,
      modifierIds: [],
      modifierNames: [],
      notes: null,
      course: null,
      seat: null,
      qty,
      unitPriceCents: Math.round(priceNum * 100),
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a custom item</DialogTitle>
        <DialogDescription>
          Something that isn&apos;t on the menu. It won&apos;t deduct stock.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        <Field>
          <FieldLabel htmlFor="custom-name">Name</FieldLabel>
          <Input
            id="custom-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Birthday cake plating"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="custom-price">Price ({currency})</FieldLabel>
          <Input
            id="custom-price"
            type="number"
            min={0}
            max={MAX_PRICE_MAJOR}
            step="0.01"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "custom-price-error" : undefined}
          />
          {error ? (
            <p id="custom-price-error" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </Field>

        <QtyStepper qty={qty} onChange={setQty} label="Quantity" />
      </DialogBody>

      <DialogFooter className="sm:justify-between">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!nameValid || !priceValid}>
          Add to order
        </Button>
      </DialogFooter>
    </>
  )
}
