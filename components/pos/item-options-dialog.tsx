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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { ChoiceChip } from "@/components/pos/choice-chip"
import { DishThumb } from "@/components/pos/dish-thumb"
import { VegMark } from "@/components/pos/veg-mark"
import { draftUnitPrice, type NewLineDraft } from "@/components/pos/cart-types"
import type { PosMenuItem } from "@/components/pos/types"

/**
 * Variant + add-on picker for one dish.
 *
 * Its own dialog rather than an accordion under the tile, which is what the old
 * inline version did — a bordered panel inside a card inside the grid, three
 * borders deep, shoving the whole grid down as it opened.
 */
export function ItemOptionsDialog({
  item,
  categoryName,
  currency,
  open,
  onOpenChange,
  onAdd,
}: {
  item: PosMenuItem | null
  categoryName?: string | null
  currency: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (draft: NewLineDraft) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {/* Keyed so switching dishes resets the form rather than carrying the
            last dish's variant across. */}
        {item ? (
          <OptionsForm
            key={item.id}
            item={item}
            categoryName={categoryName}
            currency={currency}
            onAdd={(draft) => {
              onAdd(draft)
              onOpenChange(false)
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function OptionsForm({
  item,
  categoryName,
  currency,
  onAdd,
  onCancel,
}: {
  item: PosMenuItem
  categoryName?: string | null
  currency: string
  onAdd: (draft: NewLineDraft) => void
  onCancel: () => void
}) {
  const variants = item.variants ?? []
  const modifiers = item.modifiers ?? []

  const [variantId, setVariantId] = useState<string | null>(variants[0]?.id ?? null)
  const [modifierIds, setModifierIds] = useState<string[]>([])
  const [qty, setQty] = useState(1)
  const [notes, setNotes] = useState("")
  const [course, setCourse] = useState("")
  const [seat, setSeat] = useState("")

  const unitPrice = draftUnitPrice(item, variantId, modifierIds)
  const variant = variants.find((v) => v.id === variantId) ?? null

  const toggleModifier = (id: string) =>
    setModifierIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))

  const submit = () => {
    const chosen = modifiers.filter((m) => modifierIds.includes(m.id))
    onAdd({
      itemId: item.id,
      name: item.name,
      variantId,
      variantName: variant?.name ?? null,
      // Sorted here so lineSignature stays stable regardless of tap order —
      // otherwise the same dish picked two ways looks like two lines.
      modifierIds: chosen.map((m) => m.id).sort(),
      modifierNames: chosen.map((m) => m.name),
      notes: notes.trim() || null,
      course: course ? Number(course) : null,
      seat: seat ? Number(seat) : null,
      qty,
      unitPriceCents: unitPrice,
    })
  }

  return (
    <>
      {/* pr-12 keeps the qty stepper clear of DialogContent's close button,
          which is absolutely positioned at top-3 right-3. */}
      <DialogHeader className="flex-row items-center gap-3 pr-12">
        <span className="size-12 shrink-0 overflow-hidden rounded-lg">
          <DishThumb item={item} monogramClassName="text-base" />
        </span>
        <span className="min-w-0 flex-1">
          <DialogTitle className="flex items-center gap-1.5">
            <VegMark isVeg={item.is_veg} />
            <span className="truncate">{item.name}</span>
          </DialogTitle>
          {categoryName ? (
            <span className="block truncate text-sm text-muted-foreground">{categoryName}</span>
          ) : null}
        </span>
        {/* Qty sits up here with the dish, as in the reference — it's a property
            of what you're adding, not one more field down the form. */}
        <QtyStepper qty={qty} onChange={setQty} />
      </DialogHeader>

      <DialogBody className="space-y-5">
        {variants.length > 0 ? (
          <fieldset>
            {/* Not "Size": a variant can be a flavour or a portion. */}
            <legend className="mb-2 text-sm font-semibold">Select variant</legend>
            <div className="flex flex-wrap gap-2">
              {variants.map((v) => (
                <ChoiceChip
                  key={v.id}
                  name={`variant-${item.id}`}
                  checked={variantId === v.id}
                  onSelect={() => setVariantId(v.id)}
                  label={v.name}
                  detail={money(item.base_price_cents + v.price_delta_cents, currency)}
                />
              ))}
            </div>
          </fieldset>
        ) : null}

        {modifiers.length > 0 ? (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Add-ons</legend>
            <div className="flex flex-wrap gap-2">
              {modifiers.map((m) => (
                <ChoiceChip
                  key={m.id}
                  type="checkbox"
                  name={`modifier-${item.id}`}
                  checked={modifierIds.includes(m.id)}
                  onSelect={() => toggleModifier(m.id)}
                  label={m.name}
                  detail={m.price_cents ? `+${money(m.price_cents, currency)}` : "Free"}
                />
              ))}
            </div>
          </fieldset>
        ) : null}

        <Field>
          <FieldLabel htmlFor={`notes-${item.id}`}>Add a cooking request (optional)</FieldLabel>
          <FieldDescription>This goes on the kitchen ticket.</FieldDescription>
          <Textarea
            id={`notes-${item.id}`}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Extra spicy, no onions, well done…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor={`course-${item.id}`}>Course</FieldLabel>
            <Input
              id={`course-${item.id}`}
              type="number"
              min={1}
              max={99}
              inputMode="numeric"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              placeholder="1"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`seat-${item.id}`}>Seat</FieldLabel>
            <Input
              id={`seat-${item.id}`}
              type="number"
              min={1}
              max={99}
              inputMode="numeric"
              value={seat}
              onChange={(e) => setSeat(e.target.value)}
              placeholder="2"
            />
          </Field>
        </div>
      </DialogBody>

      <DialogFooter className="sm:justify-between">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit}>
          Add · <span className="tabular-nums">{money(unitPrice * qty, currency)}</span>
        </Button>
      </DialogFooter>
    </>
  )
}

/**
 * Quantity stepper.
 *
 * `size-11` (44px) because no Button size reaches the tap-target bar on its own
 * — `icon` is 32px and even `lg` is 36px. Safe to override via className here:
 * both are plain `size-*` utilities, so tailwind-merge dedupes them and the
 * caller wins. (That's exactly what SheetContent's width *couldn't* do — its
 * base class was variant-prefixed, so nothing merged and the base won.)
 */
export function QtyStepper({
  qty,
  onChange,
  min = 1,
  label,
}: {
  qty: number
  onChange: (qty: number) => void
  min?: number
  /**
   * Omit inside a dialog that already names the dish — the buttons carry their
   * own aria-labels, so the group stays announceable without a visible one.
   */
  label?: string
}) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {label ? <span className="text-sm font-semibold">{label}</span> : null}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label="One fewer"
          disabled={qty <= min}
          onClick={() => onChange(qty - 1)}
        >
          <MinusIcon />
        </Button>
        <span aria-live="polite" className="min-w-10 text-center text-base font-semibold tabular-nums">
          {qty}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label="One more"
          disabled={qty >= 99}
          onClick={() => onChange(qty + 1)}
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  )
}
