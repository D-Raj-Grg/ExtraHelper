"use client"

import { useActionState, useState, useTransition } from "react"
import {
  addRecipe,
  adjustStock,
  createInventoryItem,
  type InvState,
} from "@/app/inventory/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Item = {
  id: string
  name: string
  uom: string
  current_qty: number
  reorder_level: number
  cost_cents: number
}
type MenuOpt = { id: string; name: string }
type Recipe = {
  id: string
  qty: number
  menu_items: { name: string } | null
  inventory_items: { name: string; uom: string } | null
}

const inputClass =
  "border-input dark:bg-input/30 h-8 rounded-md border bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"

function FormError({ state }: { state: InvState }) {
  if (state && "error" in state)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    )
  return null
}

function InventoryRow({ item, currency }: { item: Item; currency: string }) {
  const [pending, startTransition] = useTransition()
  const [delta, setDelta] = useState("")
  const [type, setType] = useState<"purchase" | "wastage" | "adjustment">("purchase")
  const low = Number(item.current_qty) <= Number(item.reorder_level)

  function apply() {
    const raw = Number(delta)
    if (!Number.isFinite(raw) || raw === 0) return
    // purchase adds, wastage removes, adjustment takes the signed value.
    const signed =
      type === "purchase" ? Math.abs(raw) : type === "wastage" ? -Math.abs(raw) : raw
    startTransition(async () => {
      await adjustStock(item.id, signed, type, "")
      setDelta("")
    })
  }

  return (
    <tr className="border-t">
      <td className="px-3 py-2 font-medium">
        {item.name}
        {low ? (
          <span className="ml-2 rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-600 dark:text-red-400">
            low stock
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 text-muted-foreground">{item.uom}</td>
      <td className={`px-3 py-2 font-medium ${low ? "text-red-600 dark:text-red-400" : ""}`}>
        {Number(item.current_qty)}
      </td>
      <td className="px-3 py-2 text-muted-foreground">{Number(item.reorder_level)}</td>
      <td className="px-3 py-2 text-muted-foreground">{money(item.cost_cents, currency)}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className={inputClass}
          >
            <option value="purchase">+ in</option>
            <option value="wastage">- waste</option>
            <option value="adjustment">± adj</option>
          </select>
          <Input
            type="number"
            step="0.001"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="qty"
            className="h-8 w-20 text-xs"
          />
          <Button size="sm" variant="secondary" disabled={pending} onClick={apply}>
            Apply
          </Button>
        </div>
      </td>
    </tr>
  )
}

export function InventoryManager({
  currency,
  items,
  menu,
  recipes,
}: {
  currency: string
  items: Item[]
  menu: MenuOpt[]
  recipes: Recipe[]
}) {
  const [itemState, itemAction, itemPending] = useActionState<InvState, FormData>(
    createInventoryItem,
    undefined,
  )
  const [recipeState, recipeAction, recipePending] = useActionState<InvState, FormData>(
    addRecipe,
    undefined,
  )
  const lowCount = items.filter(
    (i) => Number(i.current_qty) <= Number(i.reorder_level),
  ).length

  return (
    <div className="flex flex-col gap-8">
      {lowCount > 0 ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600 dark:text-red-400">
          {lowCount} item{lowCount === 1 ? "" : "s"} at or below reorder level — restock soon.
        </div>
      ) : null}

      {/* Add item */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Add ingredient</h2>
        <form action={itemAction} className="flex flex-wrap items-end gap-2">
          <Input name="name" placeholder="Name" className="max-w-40" required />
          <Input name="uom" placeholder="unit / kg / l" defaultValue="unit" className="w-28" />
          <Input name="qty" type="number" step="0.001" placeholder="qty" defaultValue={0} className="w-24" />
          <Input name="reorder" type="number" step="0.001" placeholder="reorder" defaultValue={0} className="w-24" />
          <Input name="cost" type="number" step="0.01" placeholder="cost" defaultValue={0} className="w-24" />
          <Button type="submit" size="sm" disabled={itemPending}>
            {itemPending ? "…" : "Add"}
          </Button>
          <FormError state={itemState} />
        </form>
      </section>

      {/* Items table */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Stock</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No inventory items yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium">UoM</th>
                  <th className="px-3 py-2 font-medium">On hand</th>
                  <th className="px-3 py-2 font-medium">Reorder</th>
                  <th className="px-3 py-2 font-medium">Cost</th>
                  <th className="px-3 py-2 font-medium">Adjust</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <InventoryRow key={it.id} item={it} currency={currency} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recipes / BOM */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Recipes (BOM)</h2>
        <form action={recipeAction} className="mb-3 flex flex-wrap items-center gap-2">
          <select name="menuItemId" defaultValue="" className={inputClass} required>
            <option value="">— dish —</option>
            {menu.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">uses</span>
          <select name="inventoryItemId" defaultValue="" className={inputClass} required>
            <option value="">— ingredient —</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <Input name="qty" type="number" step="0.001" placeholder="qty" className="h-8 w-20 text-xs" required />
          <Button type="submit" size="sm" variant="secondary" disabled={recipePending}>
            {recipePending ? "…" : "Map"}
          </Button>
          <FormError state={recipeState} />
        </form>
        {recipes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recipes mapped yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {recipes.map((r) => (
              <li key={r.id} className="text-muted-foreground">
                <span className="font-medium text-foreground">{r.menu_items?.name}</span> uses{" "}
                {Number(r.qty)} {r.inventory_items?.uom} of {r.inventory_items?.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
