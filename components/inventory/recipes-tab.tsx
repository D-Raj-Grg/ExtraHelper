"use client"

import { useMemo, useState } from "react"
import { CheckCircle2Icon, CircleDashedIcon, FlameIcon, PencilIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { RecipeEditor } from "./recipe-editor"
import { ModifierEditor } from "./modifier-editor"
import type {
  Item,
  MenuOpt,
  ModifierIngredient,
  ModifierOpt,
  Recipe,
  VariantOpt,
} from "./types"

export function RecipesTab({
  menu,
  items,
  recipes,
  variants,
  modifiers,
  modifierIngredients,
  currency,
}: {
  menu: MenuOpt[]
  items: Item[]
  recipes: Recipe[]
  variants: VariantOpt[]
  modifiers: ModifierOpt[]
  modifierIngredients: ModifierIngredient[]
  currency: string
}) {
  // Hold the open editor by DISH ID, not the dish object, so revalidated recipe
  // data flows in — a frozen object would show stale lines until reopen.
  const [editingDishId, setEditingDishId] = useState<string | null>(null)
  const [editingModId, setEditingModId] = useState<string | null>(null)

  const modCountById = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of modifierIngredients) map.set(m.modifier_id, (map.get(m.modifier_id) ?? 0) + 1)
    return map
  }, [modifierIngredients])
  const editingMod = modifiers.find((m) => m.id === editingModId) ?? null

  const countByDish = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of recipes) map.set(r.menu_item_id, (map.get(r.menu_item_id) ?? 0) + 1)
    return map
  }, [recipes])

  const mapped = countByDish.size
  const total = menu.length
  const pct = total ? Math.round((mapped / total) * 100) : 0
  const editingDish = menu.find((m) => m.id === editingDishId) ?? null

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Recipes</h2>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <FlameIcon className="size-3.5 shrink-0 text-orange-500" aria-hidden />
          Map each dish to its ingredients. Selling it then auto-deducts that stock on kitchen fire — no manual entry.
        </p>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="text-sm text-muted-foreground">Recipe coverage</p>
          <p className="text-2xl font-semibold tabular-nums">
            {mapped}
            <span className="text-muted-foreground"> / {total} dishes</span>
          </p>
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <div className="flex justify-between text-sm">
            <span className="font-medium tabular-nums">{pct}%</span>
            {mapped < total ? (
              <span className="text-amber-700 dark:text-amber-400">{total - mapped} unmapped — deduct nothing</span>
            ) : (
              <span className="text-emerald-700 dark:text-emerald-400">All dishes mapped</span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", pct === 100 ? "bg-emerald-500" : "bg-amber-500")}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </Card>

      {total === 0 ? (
        <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
          Add dishes on the Menu screen first, then map their ingredients here.
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dish</TableHead>
                <TableHead className="w-44">Recipe</TableHead>
                <TableHead className="w-24 text-right sr-only">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {menu.map((m) => {
                const n = countByDish.get(m.id) ?? 0
                return (
                  <TableRow
                    key={m.id}
                    className="cursor-pointer"
                    onClick={() => setEditingDishId(m.id)}
                  >
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>
                      {n > 0 ? (
                        <Badge className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2Icon className="size-3.5" />
                          {n} ingredient{n === 1 ? "" : "s"}
                        </Badge>
                      ) : (
                        <Badge className="gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                          <CircleDashedIcon className="size-3.5" />
                          No recipe
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        aria-label={`Edit recipe for ${m.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingDishId(m.id)
                        }}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {modifiers.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div>
            <h3 className="text-base font-semibold">Add-on ingredients</h3>
            <p className="text-sm text-muted-foreground">
              Map what each add-on (like extra cheese) consumes — deducted on top of the dish recipe.
            </p>
          </div>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Add-on</TableHead>
                  <TableHead className="w-44">Recipe</TableHead>
                  <TableHead className="w-24 text-right sr-only">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modifiers.map((m) => {
                  const n = modCountById.get(m.id) ?? 0
                  return (
                    <TableRow key={m.id} className="cursor-pointer" onClick={() => setEditingModId(m.id)}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell>
                        {n > 0 ? (
                          <Badge className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2Icon className="size-3.5" />
                            {n} ingredient{n === 1 ? "" : "s"}
                          </Badge>
                        ) : (
                          <Badge className="gap-1 bg-muted text-muted-foreground">
                            <CircleDashedIcon className="size-3.5" />
                            No stock impact
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11"
                          aria-label={`Edit add-on ${m.name}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingModId(m.id)
                          }}
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
      ) : null}

      <RecipeEditor
        dish={editingDish}
        recipes={recipes}
        items={items}
        variants={variants.filter((v) => v.item_id === editingDishId)}
        currency={currency}
        open={editingDishId !== null}
        onOpenChange={(o) => {
          if (!o) setEditingDishId(null)
        }}
      />

      <ModifierEditor
        modifier={editingMod}
        ingredients={modifierIngredients}
        items={items}
        open={editingModId !== null}
        onOpenChange={(o) => {
          if (!o) setEditingModId(null)
        }}
      />
    </div>
  )
}
