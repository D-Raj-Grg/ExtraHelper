"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { CheckCircle2Icon, CircleDashedIcon, CoinsIcon, CornerDownRightIcon, HistoryIcon } from "lucide-react"

import { backfillOrderItemCosts, setItemCost, setModifierCost, setVariantCost } from "@/app/(app)/inventory/actions"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  effectiveCost,
  foodCostBand,
  type Item,
  type MenuOpt,
  type ModifierIngredient,
  type ModifierOpt,
  type Recipe,
  type VariantOpt,
} from "./types"

// Same bands as the recipe editor's food-cost badge: colour reinforces the
// percentage and the word, never carries the meaning alone.
const BAND_CLASS = {
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  bad: "bg-destructive/10 text-destructive",
} as const

/** Cents → "4.5" / "12" / "0.25": what an owner would type, trailing zeros trimmed. */
function centsToInput(cents: number | null): string {
  if (cents === null) return ""
  return (cents / 100).toFixed(2).replace(/\.?0+$/, "")
}

/** Typed text → cents, or an error string. Empty clears the cost (null). */
function parseCost(raw: string): { cents: number | null } | { error: string } {
  // "1,250.50" and "1 250" are how people type money; Number() rejects both.
  const text = raw.replace(/[,\s]/g, "")
  if (text === "") return { cents: null }
  const n = Number(text)
  if (!Number.isFinite(n)) return { error: "Enter a number." }
  if (n < 0) return { error: "Cost can't be negative." }
  return { cents: Math.round(n * 100) }
}

/**
 * Costing — one cost per dish (and optionally per size), typed straight in.
 * No ingredient weighing: this is the fast path to gross profit for an owner
 * who knows a plate of momo costs them about 90 and sells for 220.
 */
export function CostingTab({
  menu,
  variants,
  recipes,
  items,
  modifiers,
  modifierIngredients,
  currency,
}: {
  menu: MenuOpt[]
  variants: VariantOpt[]
  recipes: Recipe[]
  items: Item[]
  modifiers: ModifierOpt[]
  modifierIngredients: ModifierIngredient[]
  currency: string
}) {
  // Recipe cost per dish — Σ qty × ingredient unit cost, the same maths the
  // recipe editor shows as "plate cost". Absent (not 0) when a dish has no
  // recipe lines, so an unmapped dish reads as uncosted rather than free.
  const recipeCostByDish = useMemo(() => {
    const costById = new Map(items.map((i) => [i.id, i.cost_cents]))
    const map = new Map<string, number>()
    for (const r of recipes) {
      const unit = costById.get(r.inventory_item_id) ?? 0
      map.set(r.menu_item_id, (map.get(r.menu_item_id) ?? 0) + unit * r.qty)
    }
    return map
  }, [recipes, items])

  // Add-on recipe cost — Σ modifier_ingredients.qty × ingredient unit cost.
  // Absent when the add-on has no ingredient lines, same as a dish.
  const recipeCostByModifier = useMemo(() => {
    const costById = new Map(items.map((i) => [i.id, i.cost_cents]))
    const map = new Map<string, number>()
    for (const mi of modifierIngredients) {
      const unit = costById.get(mi.inventory_item_id) ?? 0
      map.set(mi.modifier_id, (map.get(mi.modifier_id) ?? 0) + unit * mi.qty)
    }
    return map
  }, [modifierIngredients, items])

  const variantsByDish = useMemo(() => {
    const map = new Map<string, VariantOpt[]>()
    for (const v of variants) {
      const list = map.get(v.item_id)
      if (list) list.push(v)
      else map.set(v.item_id, [v])
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return map
  }, [variants])

  const recipeCostOf = (dishId: string): number | null => {
    const c = recipeCostByDish.get(dishId)
    return c === undefined ? null : Math.round(c)
  }

  // A dish with sizes is costed only when every size resolves to a cost; a
  // dish without sizes when the dish itself does. Same rule as the row badge.
  const isCosted = (m: MenuOpt): boolean => {
    const recipeCost = recipeCostOf(m.id)
    const sizes = variantsByDish.get(m.id) ?? []
    if (sizes.length === 0) return effectiveCost(m, null, recipeCost) !== null
    return sizes.every((v) => effectiveCost(m, v, recipeCost) !== null)
  }

  // Direct cost → recipe fallback → null. Mirrors the database: an add-on with
  // no cost makes every sold line that carries it uncosted.
  const modifierEffective = (m: ModifierOpt): number | null => {
    if (m.cost_cents !== null) return m.cost_cents
    const c = recipeCostByModifier.get(m.id)
    return c === undefined ? null : Math.round(c)
  }

  const total = menu.length
  const costed = menu.filter(isCosted).length
  const pct = total ? Math.round((costed / total) * 100) : 0
  // Reported beside the dish coverage, never folded into it: add-ons are
  // optional per line, so they don't change how many dishes are costed.
  const uncostedModifiers = modifiers.filter((m) => modifierEffective(m) === null).length

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Costing</h2>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CoinsIcon className="size-3.5 shrink-0 text-amber-500" aria-hidden />
          Enter what each dish costs you to make. Sales then show gross profit — no ingredient weighing needed.
        </p>
      </div>

      {total > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm text-muted-foreground">Costed</p>
            <p className="text-2xl font-semibold tabular-nums">
              {costed}
              <span className="text-muted-foreground"> / {total} dishes</span>
            </p>
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <div className="flex justify-between text-sm">
              <span className="font-medium tabular-nums">{pct}%</span>
              <span className="flex flex-wrap justify-end gap-x-2">
                {costed < total ? (
                  <span className="text-amber-700 dark:text-amber-400">
                    {total - costed} uncosted — profit shows as unknown
                  </span>
                ) : (
                  <span className="text-emerald-700 dark:text-emerald-400">All dishes costed</span>
                )}
                {uncostedModifiers > 0 ? (
                  <span className="text-muted-foreground">
                    {uncostedModifiers} add-on{uncostedModifiers === 1 ? "" : "s"} uncosted
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", pct === 100 ? "bg-emerald-500" : "bg-amber-500")}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </Card>
      ) : null}

      {total === 0 ? (
        <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
          Add dishes on the Menu screen first, then enter what each one costs here.
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dish</TableHead>
                <TableHead className="w-28 text-right">Price</TableHead>
                <TableHead className="w-36 text-right">Cost</TableHead>
                <TableHead className="w-40 text-right">Effective cost</TableHead>
                <TableHead className="w-36">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {menu.map((m) => {
                const recipeCost = recipeCostOf(m.id)
                const dishEffective = effectiveCost(m, null, recipeCost)
                const dishVariants = variantsByDish.get(m.id) ?? []
                return (
                  <CostRows
                    key={m.id}
                    dish={m}
                    variants={dishVariants}
                    recipeCost={recipeCost}
                    dishEffective={dishEffective}
                    dishCosted={isCosted(m)}
                    currency={currency}
                  />
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {modifiers.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div>
            <h3 className="text-base font-semibold">Add-on costs</h3>
            <p className="text-sm text-muted-foreground">
              A sold dish adds each add-on&apos;s cost. An add-on with no cost makes that line uncosted.
            </p>
          </div>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Add-on</TableHead>
                  <TableHead className="w-28 text-right">Price</TableHead>
                  <TableHead className="w-36 text-right">Cost</TableHead>
                  <TableHead className="w-40 text-right">Effective cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modifiers.map((m) => {
                  const eff = modifierEffective(m)
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(m.price_cents, currency)}</TableCell>
                      <TableCell className="text-right">
                        <CostInput
                          key={m.id}
                          label={`Cost for add-on ${m.name}`}
                          initialCents={m.cost_cents}
                          placeholder={m.cost_cents === null && eff !== null ? `= ${centsToInput(eff)}` : "0.00"}
                          onSave={(cents) => setModifierCost(m.id, cents)}
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <EffectiveCell
                          cents={eff}
                          currency={currency}
                          hint={m.cost_cents === null && eff !== null ? "from recipe" : null}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
      ) : null}

      <BackfillCard />
    </div>
  )
}

/** One dish row plus an indented row per size. */
function CostRows({
  dish,
  variants,
  recipeCost,
  dishEffective,
  dishCosted,
  currency,
}: {
  dish: MenuOpt
  variants: VariantOpt[]
  recipeCost: number | null
  dishEffective: number | null
  /** Coverage rule: every size costed, or the dish itself when it has none. */
  dishCosted: boolean
  currency: string
}) {
  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{dish.name}</TableCell>
        <TableCell className="text-right tabular-nums">{money(dish.price_cents, currency)}</TableCell>
        <TableCell className="text-right">
          <CostInput
            key={dish.id}
            label={`Cost for ${dish.name}`}
            initialCents={dish.cost_cents}
            placeholder="0.00"
            onSave={(cents) => setItemCost(dish.id, cents)}
          />
        </TableCell>
        <TableCell className="text-right tabular-nums">
          <EffectiveCell
            cents={dishEffective}
            currency={currency}
            hint={dish.cost_cents === null && recipeCost !== null ? "from recipe" : null}
          />
        </TableCell>
        <TableCell>
          <MarginBadge price={dish.price_cents} cost={dishCosted ? dishEffective : null} />
        </TableCell>
      </TableRow>
      {variants.map((v) => {
        const price = dish.price_cents + v.price_delta_cents
        const eff = effectiveCost(dish, v, recipeCost)
        // What this size falls back to if its own cost is left blank.
        const fallback = effectiveCost(dish, { ...v, cost_cents: null }, recipeCost)
        const hint =
          v.cost_cents !== null
            ? null
            : dish.cost_cents !== null
              ? v.recipe_scale === 1
                ? "from dish"
                : "× scale"
              : recipeCost !== null
                ? "from recipe"
                : null
        return (
          <TableRow key={v.id}>
            <TableCell className="pl-8 text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CornerDownRightIcon className="size-3.5 shrink-0" aria-hidden />
                {v.name}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{money(price, currency)}</TableCell>
            <TableCell className="text-right">
              <CostInput
                key={v.id}
                label={`Cost for ${dish.name} ${v.name}`}
                initialCents={v.cost_cents}
                placeholder={fallback !== null ? `= ${centsToInput(fallback)}` : "0.00"}
                onSave={(cents) => setVariantCost(v.id, cents)}
              />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <EffectiveCell cents={eff} currency={currency} hint={hint} />
            </TableCell>
            <TableCell>
              <MarginBadge price={price} cost={eff} />
            </TableCell>
          </TableRow>
        )
      })}
    </>
  )
}

function EffectiveCell({ cents, currency, hint }: { cents: number | null; currency: string; hint: string | null }) {
  if (cents === null) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex flex-col items-end">
      <span>{money(cents, currency)}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </span>
  )
}

/** Gross margin = (price − cost) / price. Word + percentage carry the meaning; colour reinforces. */
function MarginBadge({ price, cost }: { price: number; cost: number | null }) {
  if (cost === null) {
    return (
      <Badge className="gap-1 bg-muted text-muted-foreground">
        <CircleDashedIcon className="size-3.5" aria-hidden />
        Uncosted
      </Badge>
    )
  }
  if (price <= 0) {
    return (
      <Badge className="gap-1 bg-muted text-muted-foreground">
        <CircleDashedIcon className="size-3.5" aria-hidden />
        No price
      </Badge>
    )
  }
  const band = foodCostBand((cost / price) * 100)
  const margin = Math.round(((price - cost) / price) * 100)
  return (
    <Badge className={cn("gap-1 tabular-nums", BAND_CLASS[band])}>
      {band === "good" ? <CheckCircle2Icon className="size-3.5" aria-hidden /> : null}
      {margin}% margin
      {band === "warn" ? " · watch" : band === "bad" ? " · thin" : ""}
    </Badge>
  )
}

/**
 * One cost box. Saves on blur or Enter when the value changed; blank clears.
 * Keyed by the row id only: a revalidated server value re-seeds the text in
 * an effect (unless the box is focused), so `saved`/`error` survive the
 * refresh instead of being wiped by a remount.
 */
function CostInput({
  label,
  initialCents,
  placeholder,
  onSave,
}: {
  label: string
  initialCents: number | null
  placeholder: string
  onSave: (cents: number | null) => Promise<{ error: string } | { ok: true } | undefined>
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(() => centsToInput(initialCents))
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  // Server value changed (our save, or someone else's): adopt it unless the
  // owner is mid-edit in this very box.
  useEffect(() => {
    if (typeof document !== "undefined" && document.activeElement === ref.current) return
    setText(centsToInput(initialCents))
  }, [initialCents])

  // "Saved" fades on its own; the row stays quiet otherwise.
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 1800)
    return () => clearTimeout(t)
  }, [saved])

  function commit() {
    // Enter then blur would otherwise save twice before the revalidated
    // value re-seeds this input.
    if (pending) return
    const parsed = parseCost(text)
    if ("error" in parsed) {
      setErr(parsed.error)
      return
    }
    if (parsed.cents === initialCents) return
    setErr(null)
    startTransition(async () => {
      const res = await onSave(parsed.cents)
      if (res && "error" in res) setErr(res.error)
      else setSaved(true)
    })
  }

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <Input
        ref={ref}
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={err ? true : undefined}
        className="h-9 w-28 text-right tabular-nums"
        placeholder={placeholder}
        value={text}
        disabled={pending}
        onChange={(e) => {
          setText(e.target.value)
          setErr(null)
          setSaved(false)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          }
        }}
      />
      {err ? (
        <span className="text-xs text-destructive" role="alert">
          {err}
        </span>
      ) : (
        <span
          aria-live="polite"
          className={cn(
            "text-xs text-emerald-700 transition-opacity duration-300 ease-out motion-reduce:transition-none dark:text-emerald-400",
            saved ? "opacity-100" : "opacity-0",
          )}
        >
          {saved ? "Saved" : pending ? "Saving…" : " "}
        </span>
      )}
    </div>
  )
}

/** Apply today's costs to order lines that were sold before a cost existed. */
function BackfillCard() {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<{ updated: number } | { error: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function run() {
    setOpen(false)
    startTransition(async () => {
      setResult(null)
      const res = await backfillOrderItemCosts()
      if (!res || "error" in res) setResult({ error: res?.error ?? "Something went wrong." })
      else setResult({ updated: res.updated ?? 0 })
    })
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <HistoryIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <p className="font-semibold">Past sales</p>
          <p className="text-sm text-muted-foreground">
            Stamps today&apos;s cost onto older lines that have none, so earlier reports show profit. Lines that already
            carry a cost are untouched.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger
            render={
              <Button variant="outline" disabled={pending}>
                {pending ? "Applying…" : "Apply costs to past sales"}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apply today&apos;s costs to past sales?</AlertDialogTitle>
              <AlertDialogDescription>
                Every older line without a cost gets today&apos;s cost for that dish — the current cost, not what it was
                on the day. Lines that already carry a cost are untouched.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={run}>Apply costs</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {result && "error" in result ? (
          <p className="text-sm text-destructive" role="alert">
            {result.error}
          </p>
        ) : result ? (
          <p className="flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400" aria-live="polite">
            <CheckCircle2Icon className="size-3.5" aria-hidden />
            Updated {result.updated} line{result.updated === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>
    </Card>
  )
}
