"use client"

import { useActionState, useTransition } from "react"
import {
  createCategory,
  createItem,
  createStation,
  deleteItem,
  toggleItem86,
  type MenuState,
} from "@/app/(app)/menu/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"

type Category = { id: string; name: string }
type Station = { id: string; name: string }
type Item = {
  id: string
  name: string
  base_price_cents: number
  is_86: boolean
  category_id: string | null
  item_station_routes: { station_id: string; kitchen_stations: { name: string } | null }[]
}

const inputClass =
  "border-input dark:bg-input/30 h-9 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"

function FormError({ state }: { state: MenuState }) {
  if (state && "error" in state)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    )
  return null
}

export function MenuManager({
  currency,
  categories,
  items,
  stations,
}: {
  currency: string
  categories: Category[]
  items: Item[]
  stations: Station[]
}) {
  const [catState, catAction, catPending] = useActionState<MenuState, FormData>(
    createCategory,
    undefined,
  )
  const [itemState, itemAction, itemPending] = useActionState<MenuState, FormData>(
    createItem,
    undefined,
  )
  const [stationState, stationAction, stationPending] = useActionState<
    MenuState,
    FormData
  >(createStation, undefined)
  const [pending, startTransition] = useTransition()

  const uncategorized = items.filter((i) => !i.category_id)

  return (
    <div className="flex flex-col gap-8">
      {/* Kitchen stations ---------------------------------------------------- */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Kitchen stations</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {stations.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              No stations yet — add one to route KOTs.
            </span>
          ) : (
            stations.map((s) => (
              <span
                key={s.id}
                className="rounded-full bg-muted px-3 py-1 text-sm font-medium"
              >
                {s.name}
              </span>
            ))
          )}
        </div>
        <form action={stationAction} className="flex flex-wrap items-center gap-2">
          <Input name="name" placeholder="e.g. Grill" className="max-w-xs" required />
          <Button type="submit" size="sm" variant="secondary" disabled={stationPending}>
            {stationPending ? "Adding…" : "Add station"}
          </Button>
          <FormError state={stationState} />
        </form>
      </section>

      {/* Add category -------------------------------------------------------- */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Categories</h2>
        <form action={catAction} className="flex flex-wrap items-center gap-2">
          <Input name="name" placeholder="e.g. Starters" className="max-w-xs" required />
          <Button type="submit" size="sm" variant="secondary" disabled={catPending}>
            {catPending ? "Adding…" : "Add category"}
          </Button>
          <FormError state={catState} />
        </form>
      </section>

      {/* Add item ------------------------------------------------------------ */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Add item</h2>
        <form action={itemAction} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input name="name" placeholder="Classic Burger" required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Price</label>
            <Input name="price" type="number" min={0} step="0.01" placeholder="12.00" required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Category</label>
            <select name="categoryId" className={inputClass} defaultValue="">
              <option value="">— none —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Station</label>
            <select name="stationId" className={inputClass} defaultValue="">
              <option value="">— none —</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" size="sm" disabled={itemPending}>
            {itemPending ? "Adding…" : "Add item"}
          </Button>
        </form>
        <div className="mt-1">
          <FormError state={itemState} />
        </div>
      </section>

      {/* Items by category --------------------------------------------------- */}
      <section className="flex flex-col gap-6">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items yet.</p>
        ) : (
          [...categories, { id: "__none__", name: "Uncategorized" }].map((cat) => {
            const list =
              cat.id === "__none__"
                ? uncategorized
                : items.filter((i) => i.category_id === cat.id)
            if (list.length === 0) return null
            return (
              <div key={cat.id}>
                <h3 className="mb-2 font-medium">{cat.name}</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <Table className="w-full text-sm">
                    <TableBody>
                      {list.map((item) => (
                        <TableRow key={item.id} className="border-b last:border-0">
                          <TableCell className="px-4 py-2 font-medium">
                            {item.name}
                            {item.is_86 ? (
                              <span className="ml-2 rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-600 dark:text-red-400">
                                86
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="px-4 py-2 text-muted-foreground">
                            {money(item.base_price_cents, currency)}
                          </TableCell>
                          <TableCell className="px-4 py-2 text-muted-foreground">
                            {item.item_station_routes
                              .map((r) => r.kitchen_stations?.name)
                              .filter(Boolean)
                              .join(", ") || "—"}
                          </TableCell>
                          <TableCell className="px-4 py-2 text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant={item.is_86 ? "default" : "outline"}
                                disabled={pending}
                                onClick={() =>
                                  startTransition(async () => {
                                    await toggleItem86(item.id, !item.is_86)
                                  })
                                }
                              >
                                {item.is_86 ? "Un-86" : "86"}
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={pending}
                                onClick={() =>
                                  startTransition(async () => {
                                    await deleteItem(item.id)
                                  })
                                }
                              >
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}
