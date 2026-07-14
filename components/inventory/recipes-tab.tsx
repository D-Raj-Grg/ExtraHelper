"use client"

import { useActionState } from "react"
import { addRecipe, type InvState } from "@/app/(app)/inventory/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fmt, FormError, type Item, type MenuOpt, type Recipe } from "./types"

export function RecipesTab({
  menu,
  items,
  recipes,
}: {
  menu: MenuOpt[]
  items: Item[]
  recipes: Recipe[]
}) {
  const [state, action, pending] = useActionState<InvState, FormData>(addRecipe, undefined)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Recipes (BOM)</h2>
        <p className="text-sm text-muted-foreground">
          Tell each dish which ingredients it uses. Selling the dish then auto-deducts that stock — so on-hand stays
          accurate without manual entry.
        </p>
      </div>

      <form action={action} className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-dish">Dish</Label>
          <Select name="menuItemId" defaultValue="" required>
            <SelectTrigger id="recipe-dish" className="w-56">
              <SelectValue placeholder="Pick a dish" />
            </SelectTrigger>
            <SelectContent>
              {menu.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-ingredient">Uses ingredient</Label>
          <Select name="inventoryItemId" defaultValue="" required>
            <SelectTrigger id="recipe-ingredient" className="w-56">
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
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-qty">Qty per dish</Label>
          <Input id="recipe-qty" name="qty" type="number" step="0.001" placeholder="0.2" className="w-24 text-right tabular-nums" required />
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Mapping…" : "Map recipe"}
        </Button>
        <FormError state={state} />
      </form>

      {recipes.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No recipes mapped yet — link a dish to its ingredients above.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {recipes.map((r) => (
            <li key={r.id} className="text-muted-foreground">
              <span className="font-medium text-foreground">{r.menu_items?.name}</span> uses{" "}
              <span className="tabular-nums">{fmt(Number(r.qty))}</span> {r.inventory_items?.uom} of{" "}
              {r.inventory_items?.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
