"use client"

import { useActionState, useMemo, useState, useTransition } from "react"
import {
  addRecipe,
  adjustStock,
  createInventoryItem,
  updateInventoryItem,
  type InvState,
} from "@/app/(app)/inventory/actions"
import { money, formatDateTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"

type Item = {
  id: string
  name: string
  uom: string
  category: string | null
  current_qty: number
  reorder_level: number
  par_level: number | null
  cost_cents: number
}
type MenuOpt = { id: string; name: string }
type Recipe = {
  id: string
  qty: number
  menu_items: { name: string } | null
  inventory_items: { name: string; uom: string } | null
}
type CostRow = {
  inventory_item_id: string
  qty: number
  unit_cost_cents: number | null
  created_at: string
}

type MoveType = "purchase" | "wastage" | "adjustment" | "staff_meal" | "transfer"

function FormError({ state }: { state: InvState }) {
  if (state && "error" in state)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    )
  return null
}

function InventoryRow({
  item,
  currency,
  timezone,
  costHistory,
}: {
  item: Item
  currency: string
  timezone: string
  costHistory: CostRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [delta, setDelta] = useState("")
  const [type, setType] = useState<MoveType>("purchase")
  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // Edit-form local state (cost shown in dollars for the operator).
  const [editCategory, setEditCategory] = useState(item.category ?? "")
  const [editReorder, setEditReorder] = useState(String(item.reorder_level))
  const [editPar, setEditPar] = useState(item.par_level == null ? "" : String(item.par_level))
  const [editCost, setEditCost] = useState((item.cost_cents / 100).toFixed(2))

  const oversold = Number(item.current_qty) < 0
  const low = !oversold && Number(item.current_qty) <= Number(item.reorder_level)

  function apply() {
    const raw = Number(delta)
    if (!Number.isFinite(raw) || raw === 0) return
    // purchase / staff_meal remove or add stock; adjustment & transfer take the
    // signed value the operator typed.
    const signed =
      type === "purchase"
        ? Math.abs(raw)
        : type === "wastage" || type === "staff_meal"
          ? -Math.abs(raw)
          : raw
    startTransition(async () => {
      await adjustStock(item.id, signed, type, "")
      setDelta("")
    })
  }

  function saveEdit() {
    const reorder = Number(editReorder)
    const parTrim = editPar.trim()
    const par = parTrim === "" ? null : Number(parTrim)
    const cost = Math.round(Number(editCost) * 100)
    startTransition(async () => {
      await updateInventoryItem(item.id, {
        category: editCategory,
        reorder,
        par,
        cost,
      })
      setEditing(false)
    })
  }

  const hasHistory = costHistory.length > 0

  return (
    <>
      <TableRow className="border-t">
        <TableCell className="px-3 py-2 font-medium">
          {item.name}
          {oversold ? (
            <span className="ml-2 rounded bg-red-600/15 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
              oversold
            </span>
          ) : low ? (
            <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
              low stock
            </span>
          ) : null}
          {hasHistory ? (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="ml-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {showHistory ? "hide costs" : "cost history"}
            </button>
          ) : null}
        </TableCell>
        <TableCell className="px-3 py-2 text-muted-foreground">
          {editing ? (
            <Input
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
              placeholder="category"
              className="h-8 w-28 text-xs"
            />
          ) : (
            item.category ?? <span className="text-muted-foreground/60">—</span>
          )}
        </TableCell>
        <TableCell className="px-3 py-2 text-muted-foreground">{item.uom}</TableCell>
        <TableCell
          className={`px-3 py-2 font-medium ${
            oversold
              ? "text-red-700 dark:text-red-400"
              : low
                ? "text-amber-600 dark:text-amber-400"
                : ""
          }`}
        >
          {Number(item.current_qty)}
        </TableCell>
        <TableCell className="px-3 py-2 text-muted-foreground">
          {editing ? (
            <Input
              type="number"
              step="0.001"
              value={editReorder}
              onChange={(e) => setEditReorder(e.target.value)}
              className="h-8 w-20 text-xs"
            />
          ) : (
            Number(item.reorder_level)
          )}
        </TableCell>
        <TableCell className="px-3 py-2 text-muted-foreground">
          {editing ? (
            <Input
              type="number"
              step="0.001"
              value={editPar}
              onChange={(e) => setEditPar(e.target.value)}
              placeholder="par"
              className="h-8 w-20 text-xs"
            />
          ) : item.par_level == null ? (
            <span className="text-muted-foreground/60">—</span>
          ) : (
            Number(item.par_level)
          )}
        </TableCell>
        <TableCell className="px-3 py-2 text-muted-foreground">
          {editing ? (
            <Input
              type="number"
              step="0.01"
              value={editCost}
              onChange={(e) => setEditCost(e.target.value)}
              className="h-8 w-24 text-xs"
            />
          ) : (
            money(item.cost_cents, currency)
          )}
        </TableCell>
        <TableCell className="px-3 py-2">
          {editing ? (
            <div className="flex items-center gap-1">
              <Button size="sm" disabled={pending} onClick={saveEdit}>
                Save
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Select value={type} onValueChange={(v) => setType((v ?? "purchase") as MoveType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase">+ in</SelectItem>
                  <SelectItem value="wastage">- waste</SelectItem>
                  <SelectItem value="staff_meal">Staff meal</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  <SelectItem value="adjustment">± adj</SelectItem>
                </SelectContent>
              </Select>
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
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
          )}
        </TableCell>
      </TableRow>
      {type === "transfer" && !editing ? (
        <TableRow>
          <TableCell colSpan={8} className="px-3 pb-2 pt-0 text-xs text-muted-foreground/70">
            Transfer logs a signed stock movement only — full branch-to-branch transfers are out of scope.
          </TableCell>
        </TableRow>
      ) : null}
      {showHistory && hasHistory ? (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/30 px-3 py-2">
            <div className="text-xs">
              <p className="mb-1 font-medium">Cost history</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {costHistory.map((c, idx) => (
                  <li key={`${c.created_at}-${idx}`} className="flex gap-3">
                    <span>{formatDateTime(c.created_at, timezone)}</span>
                    <span className="font-medium text-foreground">
                      {c.unit_cost_cents == null ? "—" : money(c.unit_cost_cents, currency)}
                    </span>
                    <span>· qty {Number(c.qty)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

export function InventoryManager({
  currency,
  timezone,
  items,
  menu,
  recipes,
  costHistory,
}: {
  currency: string
  timezone: string
  items: Item[]
  menu: MenuOpt[]
  recipes: unknown[]
  costHistory: CostRow[]
}) {
  const recipeList = recipes as Recipe[]
  const [itemState, itemAction, itemPending] = useActionState<InvState, FormData>(
    createInventoryItem,
    undefined,
  )
  const [recipeState, recipeAction, recipePending] = useActionState<InvState, FormData>(
    addRecipe,
    undefined,
  )

  // Cost history grouped by item, newest first (input already sorted newest-first).
  const historyByItem = useMemo(() => {
    const map = new Map<string, CostRow[]>()
    for (const row of costHistory) {
      const list = map.get(row.inventory_item_id)
      if (list) list.push(row)
      else map.set(row.inventory_item_id, [row])
    }
    return map
  }, [costHistory])

  const oversoldCount = items.filter((i) => Number(i.current_qty) < 0).length
  const lowCount = items.filter(
    (i) => Number(i.current_qty) >= 0 && Number(i.current_qty) <= Number(i.reorder_level),
  ).length

  return (
    <div className="flex flex-col gap-8">
      {oversoldCount > 0 ? (
        <div className="rounded-lg border border-red-600/40 bg-red-600/10 p-3 text-sm font-medium text-red-700 dark:text-red-400">
          {oversoldCount} item{oversoldCount === 1 ? "" : "s"} oversold (negative stock) — sales
          exceeded counted stock. Reconcile with a stock count or receive a PO.
        </div>
      ) : null}
      {lowCount > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-600 dark:text-amber-400">
          {lowCount} item{lowCount === 1 ? "" : "s"} at or below reorder level — restock soon.
        </div>
      ) : null}

      {/* Add item */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Add ingredient</h2>
        <form action={itemAction} className="flex flex-wrap items-end gap-2">
          <Input name="name" placeholder="Name" className="max-w-40" required />
          <Input name="category" placeholder="Category" className="w-32" />
          <Input name="uom" placeholder="unit / kg / l" defaultValue="unit" className="w-28" />
          <Input name="qty" type="number" step="0.001" placeholder="qty" defaultValue={0} className="w-24" />
          <Input name="reorder" type="number" step="0.001" placeholder="reorder" defaultValue={0} className="w-24" />
          <Input name="par" type="number" step="0.001" placeholder="par" className="w-24" />
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
            <Table className="w-full text-sm">
              <TableHeader className="bg-muted/50 text-left">
                <TableRow>
                  <TableHead className="px-3 py-2 font-medium">Item</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Category</TableHead>
                  <TableHead className="px-3 py-2 font-medium">UoM</TableHead>
                  <TableHead className="px-3 py-2 font-medium">On hand</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Reorder</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Par</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Cost</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Adjust</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <InventoryRow
                    key={it.id}
                    item={it}
                    currency={currency}
                    timezone={timezone}
                    costHistory={historyByItem.get(it.id) ?? []}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Recipes / BOM */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Recipes (BOM)</h2>
        <form action={recipeAction} className="mb-3 flex flex-wrap items-center gap-2">
          <Select name="menuItemId" defaultValue="" required>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="— dish —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">— dish —</SelectItem>
              {menu.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">uses</span>
          <Select name="inventoryItemId" defaultValue="" required>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="— ingredient —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">— ingredient —</SelectItem>
              {items.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input name="qty" type="number" step="0.001" placeholder="qty" className="h-8 w-20 text-xs" required />
          <Button type="submit" size="sm" variant="secondary" disabled={recipePending}>
            {recipePending ? "…" : "Map"}
          </Button>
          <FormError state={recipeState} />
        </form>
        {recipeList.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recipes mapped yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {recipeList.map((r) => (
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
