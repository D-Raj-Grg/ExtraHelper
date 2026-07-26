"use client"

import { useMemo, useState, useTransition } from "react"
import { SearchIcon } from "lucide-react"
import { deleteItem, toggleItem86 } from "@/app/(app)/menu/actions"
import { money } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { VegMark } from "@/components/pos/veg-mark"
import { AddItemSheet, ItemEditorSheet } from "./item-editor-sheet"
import type { Category, Item, Modifier, Station } from "./types"

const UNCATEGORIZED = "__none__"

export function ItemsTab({
  currency,
  categories,
  items,
  stations,
  modifiers,
}: {
  currency: string
  categories: Category[]
  items: Item[]
  stations: Station[]
  modifiers: Modifier[]
}) {
  const [query, setQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [soldOutOnly, setSoldOutOnly] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  // Track the open item by id, not by value. Holding the object itself froze a
  // copy taken at click time, so anything the editor added (a variant, an
  // add-on, a station route) only appeared after closing and reopening the
  // sheet. Deriving from `items` means the server action's revalidate flows
  // straight through.
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = editingId === null ? null : (items.find((i) => i.id === editingId) ?? null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((i) => {
      if (q && !i.name.toLowerCase().includes(q)) return false
      if (soldOutOnly && !i.is_86) return false
      if (categoryFilter === "all") return true
      if (categoryFilter === UNCATEGORIZED) return !i.category_id
      return i.category_id === categoryFilter
    })
  }, [items, query, categoryFilter, soldOutOnly])

  // Group the filtered items by category, preserving category sort order.
  const groups = useMemo(() => {
    const buckets: { id: string; name: string; list: Item[] }[] = []
    for (const cat of categories) {
      const list = filtered.filter((i) => i.category_id === cat.id)
      if (list.length) buckets.push({ id: cat.id, name: cat.name, list })
    }
    const uncategorized = filtered.filter((i) => !i.category_id)
    if (uncategorized.length) buckets.push({ id: UNCATEGORIZED, name: "Uncategorized", list: uncategorized })
    return buckets
  }, [filtered, categories])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Items</h2>
        <p className="text-sm text-muted-foreground">
          Everything you sell. Click an item to edit price, photo, sizes, add-ons, kitchen routing and hours.
          <span className="mx-1.5">·</span>
          <span className="font-medium text-foreground">86</span> = mark sold-out; it hides from ordering.
        </p>
      </div>

      {/* Toolbar --------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Label htmlFor="item-search" className="sr-only">
            Search items by name
          </Label>
          <Input
            id="item-search"
            className="pl-9"
            placeholder="Search items…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Label htmlFor="item-category-filter" className="sr-only">
          Filter by category
        </Label>
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v ?? "all")}>
          <SelectTrigger id="item-category-filter" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
            <SelectItem value={UNCATEGORIZED}>Uncategorized</SelectItem>
          </SelectContent>
        </Select>
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={soldOutOnly} onCheckedChange={(v) => setSoldOutOnly(Boolean(v))} />
          Sold-out only
        </label>
        <Button className="ml-auto" onClick={() => setAddOpen(true)}>
          + Add item
        </Button>
      </div>

      {/* List ------------------------------------------------------------ */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">No items yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your first dish or drink to start building the menu.
          </p>
          <Button className="mt-4" onClick={() => setAddOpen(true)}>
            + Add item
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No items match your filters.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <div key={g.id}>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">{g.name}</h3>
              <div className="divide-y overflow-hidden rounded-lg border">
                {g.list.map((item) => (
                  <ItemRow key={item.id} item={item} currency={currency} onEdit={() => setEditingId(item.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddItemSheet open={addOpen} onOpenChange={setAddOpen} categories={categories} stations={stations} />
      <ItemEditorSheet
        item={editing}
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditingId(null)
        }}
        categories={categories}
        stations={stations}
        modifiers={modifiers}
        currency={currency}
      />
    </div>
  )
}

function ItemRow({ item, currency, onEdit }: { item: Item; currency: string; onEdit: () => void }) {
  const [pending, startTransition] = useTransition()
  const routes =
    item.item_station_routes
      .map((r) => r.kitchen_stations?.name)
      .filter(Boolean)
      .join(", ") || "No station"

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {/* Same slot as the POS tile, so admin and till read alike. */}
          <VegMark isVeg={item.is_veg} />
          <span className="truncate font-medium">{item.name}</span>
          {item.is_86 ? <Badge variant="destructive">86</Badge> : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{routes}</p>
      </div>
      <span className="tabular-nums text-muted-foreground">{money(item.base_price_cents, currency)}</span>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="outline" onClick={onEdit} aria-label={`Edit ${item.name}`}>
          Edit
        </Button>
        <Button
          size="sm"
          variant={item.is_86 ? "default" : "outline"}
          disabled={pending}
          aria-label={item.is_86 ? `Mark ${item.name} available` : `Mark ${item.name} sold out`}
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
          aria-label={`Delete ${item.name}`}
          onClick={() =>
            startTransition(async () => {
              await deleteItem(item.id)
            })
          }
        >
          Delete
        </Button>
      </div>
    </div>
  )
}
