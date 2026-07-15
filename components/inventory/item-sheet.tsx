"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { createInventoryItem, updateInventoryItem, type InvState } from "@/app/(app)/inventory/actions"
import { money, formatDateTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { fmt, FormError, type CostRow, type Item } from "./types"

// ============================================================================
// Add-ingredient sheet
// ============================================================================

export function AddIngredientSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [state, action, pending] = useActionState<InvState, FormData>(createInventoryItem, undefined)

  useEffect(() => {
    if (state && "ok" in state) onOpenChange(false)
  }, [state, onOpenChange])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg" className="w-full gap-0">
        <SheetHeader>
          <SheetTitle>Add ingredient</SheetTitle>
          <SheetDescription>
            A raw stock item you track (flour, oil, a bottle of cola). Map it to dishes on the Recipes tab so sales
            auto-deduct it.
          </SheetDescription>
        </SheetHeader>
        <form
          action={action}
          key={open ? "open" : "closed"}
          className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6"
        >
          <Field>
            <FieldLabel htmlFor="add-inv-name">Name</FieldLabel>
            <Input id="add-inv-name" name="name" placeholder="Flour" required />
          </Field>
          <div className="flex flex-wrap gap-4">
            <Field className="w-40">
              <FieldLabel htmlFor="add-inv-uom">Unit of measure</FieldLabel>
              <Input id="add-inv-uom" name="uom" placeholder="kg" defaultValue="unit" />
              <FieldDescription>How you buy/count it — kg, l, each.</FieldDescription>
            </Field>
            <Field className="w-40">
              <FieldLabel htmlFor="add-inv-category">Category</FieldLabel>
              <Input id="add-inv-category" name="category" placeholder="Dry goods" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <Field className="w-28">
              <FieldLabel htmlFor="add-inv-qty">On hand</FieldLabel>
              <Input id="add-inv-qty" name="qty" type="number" step="0.001" defaultValue={0} className="text-right tabular-nums" />
            </Field>
            <Field className="w-28">
              <FieldLabel htmlFor="add-inv-cost">Unit cost</FieldLabel>
              <Input id="add-inv-cost" name="cost" type="number" step="0.01" defaultValue={0} className="text-right tabular-nums" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <Field className="w-28">
              <FieldLabel htmlFor="add-inv-reorder">Reorder at</FieldLabel>
              <Input id="add-inv-reorder" name="reorder" type="number" step="0.001" defaultValue={0} className="text-right tabular-nums" />
              <FieldDescription>Warn me at/below this.</FieldDescription>
            </Field>
            <Field className="w-28">
              <FieldLabel htmlFor="add-inv-par">Par (target)</FieldLabel>
              <Input id="add-inv-par" name="par" type="number" step="0.001" placeholder="—" className="text-right tabular-nums" />
              <FieldDescription>Restock up to this.</FieldDescription>
            </Field>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add ingredient"}
            </Button>
            <FormError state={state} />
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

// ============================================================================
// Edit-item sheet (levels + cost history)
// ============================================================================

export function ItemSheet({
  item,
  open,
  onOpenChange,
  currency,
  timezone,
  costHistory,
}: {
  item: Item | null
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: string
  timezone: string
  costHistory: CostRow[]
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg" className="w-full gap-0">
        {item ? (
          <>
            <SheetHeader>
              <SheetTitle>{item.name}</SheetTitle>
              <SheetDescription>
                {fmt(Number(item.current_qty))} {item.uom} on hand · {money(item.cost_cents, currency)} per {item.uom}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-1 flex-col gap-8 overflow-y-auto px-6 pb-8">
              <ItemEditBody key={item.id} item={item} onSaved={() => onOpenChange(false)} />
              <CostHistory costHistory={costHistory} currency={currency} timezone={timezone} />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function ItemEditBody({ item, onSaved }: { item: Item; onSaved: () => void }) {
  const [name, setName] = useState(item.name)
  const [uom, setUom] = useState(item.uom)
  const [category, setCategory] = useState(item.category ?? "")
  const [reorder, setReorder] = useState(String(item.reorder_level))
  const [par, setPar] = useState(item.par_level == null ? "" : String(item.par_level))
  const [cost, setCost] = useState((item.cost_cents / 100).toFixed(2))
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    const reorderN = Number(reorder)
    const parTrim = par.trim()
    const parN = parTrim === "" ? null : Number(parTrim)
    const costN = Math.round(Number(cost) * 100)
    startTransition(async () => {
      setErr(null)
      const res = await updateInventoryItem(item.id, {
        name,
        uom,
        category,
        reorder: reorderN,
        par: parN,
        cost: costN,
      })
      if (res && "error" in res) setErr(res.error)
      else onSaved()
    })
  }

  return (
    <FieldSet>
      <FieldLegend variant="label">Item details &amp; levels</FieldLegend>
      <div className="flex flex-wrap gap-4">
        <Field className="min-w-40 flex-1">
          <FieldLabel htmlFor="edit-inv-name">Name</FieldLabel>
          <Input id="edit-inv-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field className="w-28">
          <FieldLabel htmlFor="edit-inv-uom">Unit</FieldLabel>
          <Input id="edit-inv-uom" value={uom} onChange={(e) => setUom(e.target.value)} />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="edit-inv-category">Category</FieldLabel>
        <Input id="edit-inv-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="—" />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Field className="w-28">
          <FieldLabel htmlFor="edit-inv-reorder">Reorder at</FieldLabel>
          <Input id="edit-inv-reorder" type="number" step="0.001" value={reorder} onChange={(e) => setReorder(e.target.value)} className="text-right tabular-nums" />
          <FieldDescription>Low-stock warning threshold.</FieldDescription>
        </Field>
        <Field className="w-28">
          <FieldLabel htmlFor="edit-inv-par">Par (target)</FieldLabel>
          <Input id="edit-inv-par" type="number" step="0.001" value={par} onChange={(e) => setPar(e.target.value)} placeholder="—" className="text-right tabular-nums" />
          <FieldDescription>Level to restock up to.</FieldDescription>
        </Field>
        <Field className="w-28">
          <FieldLabel htmlFor="edit-inv-cost">Unit cost</FieldLabel>
          <Input id="edit-inv-cost" type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className="text-right tabular-nums" />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <FormError state={err ? { error: err } : undefined} />
      </div>
    </FieldSet>
  )
}

function CostHistory({
  costHistory,
  currency,
  timezone,
}: {
  costHistory: CostRow[]
  currency: string
  timezone: string
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label">Cost history</FieldLegend>
      {costHistory.length === 0 ? (
        <p className="text-sm text-muted-foreground">No purchases recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {costHistory.map((c, idx) => (
            <li key={`${c.created_at}-${idx}`} className="flex gap-3">
              <span className="tabular-nums">{formatDateTime(c.created_at, timezone)}</span>
              <span className="font-medium text-foreground tabular-nums">
                {c.unit_cost_cents == null ? "—" : money(c.unit_cost_cents, currency)}
              </span>
              <span className="tabular-nums">· qty {fmt(Number(c.qty))}</span>
            </li>
          ))}
        </ul>
      )}
    </FieldSet>
  )
}
