"use client"

import { useState, useTransition } from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"

import { setModifierRecipe } from "@/app/(app)/inventory/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Item, ModifierIngredient, ModifierOpt } from "./types"

type EditLine = { lineId: string; inventoryItemId: string; qty: string }

function newLine(inventoryItemId = "", qty = ""): EditLine {
  return { lineId: crypto.randomUUID(), inventoryItemId, qty }
}

/**
 * Add-on (modifier) ingredient editor. Sets what an add-on like "Extra cheese"
 * consumes — deducted on top of the dish recipe when the add-on is sold.
 */
export function ModifierEditor({
  modifier,
  ingredients,
  items,
  open,
  onOpenChange,
}: {
  modifier: ModifierOpt | null
  ingredients: ModifierIngredient[]
  items: Item[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg" className="w-full gap-0">
        {modifier ? (
          <ModifierEditorBody
            key={modifier.id}
            modifier={modifier}
            ingredients={ingredients}
            items={items}
            onSaved={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function ModifierEditorBody({
  modifier,
  ingredients,
  items,
  onSaved,
}: {
  modifier: ModifierOpt
  ingredients: ModifierIngredient[]
  items: Item[]
  onSaved: () => void
}) {
  const [lines, setLines] = useState<EditLine[]>(() => {
    const existing = ingredients
      .filter((m) => m.modifier_id === modifier.id)
      .map((m) => newLine(m.inventory_item_id, String(m.qty)))
    return existing.length ? existing : [newLine()]
  })
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const itemById = new Map(items.map((i) => [i.id, i]))

  function patch(lineId: string, next: Partial<EditLine>) {
    setLines((ls) => ls.map((l) => (l.lineId === lineId ? { ...l, ...next } : l)))
  }
  function save() {
    startTransition(async () => {
      setErr(null)
      const res = await setModifierRecipe(
        modifier.id,
        lines
          .filter((l) => l.inventoryItemId)
          .map((l) => ({ inventoryItemId: l.inventoryItemId, qty: Number(l.qty) })),
      )
      if (res && "error" in res) setErr(res.error)
      else onSaved()
    })
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{modifier.name}</SheetTitle>
        <SheetDescription>
          What this add-on consumes. Deducted on top of the dish&apos;s recipe when it&apos;s sold.
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead className="w-40">Qty</TableHead>
              <TableHead className="w-12 sr-only">Remove</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => {
              const item = itemById.get(l.inventoryItemId)
              return (
                <TableRow key={l.lineId}>
                  <TableCell>
                    <Select
                      value={l.inventoryItemId}
                      onValueChange={(v) => patch(l.lineId, { inventoryItemId: v as string })}
                    >
                      <SelectTrigger className="w-full" aria-label="Ingredient">
                        <SelectValue placeholder="Pick an ingredient" />
                      </SelectTrigger>
                      <SelectContent>
                        {items.map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        inputMode="decimal"
                        aria-label="Quantity per add-on"
                        className="w-24 text-right tabular-nums"
                        value={l.qty}
                        onChange={(e) => patch(l.lineId, { qty: e.target.value })}
                      />
                      <span className="min-w-8 text-sm text-muted-foreground">{item?.uom ?? ""}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label="Remove ingredient"
                      onClick={() => setLines((ls) => ls.filter((x) => x.lineId !== l.lineId))}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setLines((ls) => [...ls, newLine()])}
        >
          <PlusIcon className="size-4" /> Add ingredient
        </Button>

        <div className="flex items-center gap-3 pt-1">
          <Button type="button" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save add-on recipe"}
          </Button>
          {err ? (
            <p className="text-sm text-destructive" role="alert">
              {err}
            </p>
          ) : null}
        </div>
      </div>
    </>
  )
}
