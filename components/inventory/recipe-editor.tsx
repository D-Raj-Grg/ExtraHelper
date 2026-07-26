"use client"

import { useState, useTransition } from "react"
import { FlameIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { setDishRecipe, updateVariantScale } from "@/app/(app)/inventory/actions"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { foodCostBand, type Item, type MenuOpt, type Recipe, type VariantOpt } from "./types"

/** An editable line. `lineId` is a stable local key so a row never remounts on
 *  keystroke (which would lose the caret) — never key on ingredient/qty. */
type EditLine = { lineId: string; inventoryItemId: string; qty: string }

const BAND_CLASS = {
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  bad: "bg-destructive/10 text-destructive",
} as const
const BAND_LABEL = { good: "Healthy", warn: "Watch", bad: "High" } as const

function newLine(inventoryItemId = "", qty = ""): EditLine {
  return { lineId: crypto.randomUUID(), inventoryItemId, qty }
}

/**
 * Per-dish recipe editor. Opens for one dish, shows every ingredient line at
 * once, and saves the whole recipe in one call (setDishRecipe reconciles adds,
 * edits and removals). Live plate cost + food-cost % vs the dish's sale price.
 */
export function RecipeEditor({
  dish,
  recipes,
  items,
  variants,
  currency,
  open,
  onOpenChange,
}: {
  dish: MenuOpt | null
  recipes: Recipe[]
  items: Item[]
  variants: VariantOpt[]
  currency: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg" className="w-full gap-0">
        {dish ? (
          <RecipeEditorBody
            key={dish.id}
            dish={dish}
            recipes={recipes}
            items={items}
            variants={variants}
            currency={currency}
            onSaved={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function RecipeEditorBody({
  dish,
  recipes,
  items,
  variants,
  currency,
  onSaved,
}: {
  dish: MenuOpt
  recipes: Recipe[]
  items: Item[]
  variants: VariantOpt[]
  currency: string
  onSaved: () => void
}) {
  const [lines, setLines] = useState<EditLine[]>(() => {
    const existing = recipes
      .filter((r) => r.menu_item_id === dish.id)
      .map((r) => newLine(r.inventory_item_id, String(r.qty)))
    return existing.length ? existing : [newLine()]
  })
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const itemById = new Map(items.map((i) => [i.id, i]))
  const lineCost = (l: EditLine) => {
    const item = itemById.get(l.inventoryItemId)
    const qty = Number(l.qty)
    if (!item || !Number.isFinite(qty)) return 0
    return Math.round(item.cost_cents * qty)
  }
  const plateCost = lines.reduce((s, l) => s + lineCost(l), 0)
  const pct = dish.price_cents > 0 ? (plateCost / dish.price_cents) * 100 : null
  const band = pct === null ? null : foodCostBand(pct)

  function patch(lineId: string, next: Partial<EditLine>) {
    setLines((ls) => ls.map((l) => (l.lineId === lineId ? { ...l, ...next } : l)))
  }
  function remove(lineId: string) {
    setLines((ls) => ls.filter((l) => l.lineId !== lineId))
  }
  function save() {
    startTransition(async () => {
      setErr(null)
      const res = await setDishRecipe(
        dish.id,
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
        <SheetTitle>{dish.name}</SheetTitle>
        <SheetDescription className="flex items-center gap-1.5">
          <FlameIcon className="size-3.5 shrink-0 text-orange-500" aria-hidden />
          Selling this dish auto-deducts these ingredients when the order fires to the kitchen.
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead className="w-40">Qty</TableHead>
              <TableHead className="w-28 text-right">Line cost</TableHead>
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
                        aria-label="Quantity per dish"
                        className="w-24 text-right tabular-nums"
                        value={l.qty}
                        onChange={(e) => patch(l.lineId, { qty: e.target.value })}
                      />
                      <span className="min-w-8 text-sm text-muted-foreground">{item?.uom ?? ""}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item && l.qty ? money(lineCost(l), currency) : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label="Remove ingredient"
                      onClick={() => remove(l.lineId)}
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

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4">
          <div>
            <p className="text-xs text-muted-foreground">Plate cost</p>
            <p className="text-xl font-semibold tabular-nums">{money(plateCost, currency)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">
              Food cost vs {money(dish.price_cents, currency)} price
            </p>
            {pct === null ? (
              <p className="text-sm text-muted-foreground">Set a sale price to see food cost</p>
            ) : (
              <Badge className={cn("mt-0.5 gap-1 text-sm tabular-nums", BAND_CLASS[band!])}>
                {pct.toFixed(0)}% · {BAND_LABEL[band!]}
              </Badge>
            )}
          </div>
        </div>

        {variants.length > 0 ? (
          <div className="mt-2 flex flex-col gap-3 rounded-lg border p-4">
            <div>
              <p className="text-sm font-semibold">Portion scale</p>
              <p className="text-xs text-muted-foreground">
                How much of the recipe each variant uses — Half = 0.5, Large = 1.5. Deducted per sale.
              </p>
            </div>
            {variants.map((v) => (
              <VariantScaleRow key={v.id} variant={v} />
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-3 pt-1">
          <Button type="button" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save recipe"}
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

function VariantScaleRow({ variant }: { variant: VariantOpt }) {
  const [scale, setScale] = useState(String(variant.recipe_scale))
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()
  const dirty = scale !== String(variant.recipe_scale)

  function save() {
    startTransition(async () => {
      setSaved(false)
      const res = await updateVariantScale(variant.id, Number(scale))
      if (!res || "ok" in res) setSaved(true)
    })
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field className="w-32">
        <FieldLabel htmlFor={`scale-${variant.id}`}>{variant.name}</FieldLabel>
        <Input
          id={`scale-${variant.id}`}
          type="number"
          step="0.05"
          min="0"
          inputMode="decimal"
          className="text-right tabular-nums"
          value={scale}
          onChange={(e) => {
            setScale(e.target.value)
            setSaved(false)
          }}
        />
      </Field>
      <Button type="button" variant="secondary" disabled={pending || !dirty} onClick={save}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {saved && !dirty ? (
        <FieldDescription className="pb-2 text-emerald-700 dark:text-emerald-400">Saved</FieldDescription>
      ) : null}
    </div>
  )
}
