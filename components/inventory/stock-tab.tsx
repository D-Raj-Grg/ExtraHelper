"use client"

import { useMemo, useState, useTransition } from "react"
import { SearchIcon } from "lucide-react"
import { adjustStock } from "@/app/(app)/inventory/actions"
import { money } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AddIngredientSheet, ItemSheet } from "./item-sheet"
import { fmt, LOW_BADGE, MOVE_LABELS, type CostRow, type Item, type MoveType } from "./types"

type StatusFilter = "all" | "low" | "oversold"

export function StockTab({
  currency,
  timezone,
  items,
  historyByItem,
}: {
  currency: string
  timezone: string
  items: Item[]
  historyByItem: Map<string, CostRow[]>
}) {
  const [query, setQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter((c): c is string => Boolean(c)))].sort(),
    [items],
  )

  const { lowCount, oversoldCount } = useMemo(() => {
    let low = 0
    let over = 0
    for (const i of items) {
      const q = Number(i.current_qty)
      if (q < 0) over++
      else if (q <= Number(i.reorder_level)) low++
    }
    return { lowCount: low, oversoldCount: over }
  }, [items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((i) => {
      if (q && !i.name.toLowerCase().includes(q)) return false
      if (categoryFilter !== "all" && (i.category ?? "") !== categoryFilter) return false
      const qty = Number(i.current_qty)
      if (status === "oversold" && qty >= 0) return false
      if (status === "low" && !(qty >= 0 && qty <= Number(i.reorder_level))) return false
      return true
    })
  }, [items, query, categoryFilter, status])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Stock</h2>
        <p className="text-sm text-muted-foreground">
          Raw ingredients you track. Selling a dish auto-deducts its recipe ingredients. Use each card&apos;s quick
          control to record stock received or wasted; open a card to edit its levels.
        </p>
      </div>

      {/* Summary stat cards --------------------------------------------- */}
      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            label="Ingredients"
            value={items.length}
            active={status === "all"}
            onClick={() => setStatus("all")}
          />
          <StatCard
            label="Low stock"
            value={lowCount}
            tone={lowCount > 0 ? "amber" : "muted"}
            active={status === "low"}
            onClick={() => setStatus(status === "low" ? "all" : "low")}
          />
          <StatCard
            label="Oversold"
            value={oversoldCount}
            tone={oversoldCount > 0 ? "destructive" : "muted"}
            active={status === "oversold"}
            onClick={() => setStatus(status === "oversold" ? "all" : "oversold")}
          />
        </div>
      ) : null}
      {oversoldCount > 0 ? (
        <p className="-mt-2 text-xs text-destructive">
          Oversold items sold more than counted (negative on hand) — reconcile with a stock count or receive a PO.
        </p>
      ) : null}

      {/* Toolbar --------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Label htmlFor="stock-search" className="sr-only">
            Search ingredients by name
          </Label>
          <Input
            id="stock-search"
            className="pl-9"
            placeholder="Search ingredients…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {categories.length > 0 ? (
          <>
            <Label htmlFor="stock-category" className="sr-only">
              Filter by category
            </Label>
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v ?? "all")}>
              <SelectTrigger id="stock-category" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : null}
        <Button className="ml-auto" onClick={() => setAddOpen(true)}>
          + Add ingredient
        </Button>
      </div>

      {/* Cards ----------------------------------------------------------- */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="font-medium">No ingredients yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add your first ingredient to start tracking stock.</p>
          <Button className="mt-4" onClick={() => setAddOpen(true)}>
            + Add ingredient
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No ingredients match your filters.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <StockCard key={item.id} item={item} currency={currency} onEdit={() => setEditing(item)} />
          ))}
        </div>
      )}

      <AddIngredientSheet open={addOpen} onOpenChange={setAddOpen} />
      <ItemSheet
        item={editing}
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null)
        }}
        currency={currency}
        timezone={timezone}
        costHistory={editing ? (historyByItem.get(editing.id) ?? []) : []}
      />
    </div>
  )
}

function StatCard({
  label,
  value,
  tone = "muted",
  active,
  onClick,
}: {
  label: string
  value: number
  tone?: "muted" | "amber" | "destructive"
  active: boolean
  onClick: () => void
}) {
  const toneText =
    tone === "destructive"
      ? "text-destructive"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-400"
        : "text-foreground"
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl bg-card px-4 py-3 text-left ring-1 transition-colors ${
        active ? "ring-2 ring-ring" : "ring-foreground/10 hover:ring-foreground/20"
      }`}
    >
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className={`mt-0.5 block text-2xl font-semibold tabular-nums ${toneText}`}>{value}</span>
    </button>
  )
}

function StockCard({ item, currency, onEdit }: { item: Item; currency: string; onEdit: () => void }) {
  const [pending, startTransition] = useTransition()
  const [delta, setDelta] = useState("")
  const [type, setType] = useState<MoveType>("purchase")

  const qty = Number(item.current_qty)
  const oversold = qty < 0
  const low = !oversold && qty <= Number(item.reorder_level)
  const qtyTone = oversold ? "text-destructive" : low ? "text-amber-700 dark:text-amber-400" : "text-foreground"

  function apply() {
    const raw = Number(delta)
    if (!Number.isFinite(raw) || raw === 0) return
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

  return (
    <Card size="sm" className="gap-0">
      <CardHeader>
        <button type="button" onClick={onEdit} aria-label={`Edit ${item.name}`} className="text-left">
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-medium">{item.name}</span>
            {oversold ? (
              <Badge variant="destructive">Oversold</Badge>
            ) : low ? (
              <Badge className={LOW_BADGE}>Low stock</Badge>
            ) : null}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {item.category ? `${item.category} · ` : ""}
            {money(item.cost_cents, currency)} / {item.uom}
          </span>
        </button>
      </CardHeader>

      <CardContent className="flex items-end justify-between gap-2 pt-1">
        <div>
          <span className={`text-2xl font-semibold tabular-nums ${qtyTone}`}>{fmt(qty)}</span>
          <span className="ml-1 text-sm text-muted-foreground">{item.uom}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
            on hand · reorder {fmt(Number(item.reorder_level))}
            {item.par_level != null ? ` · par ${fmt(Number(item.par_level))}` : ""}
          </span>
        </div>
      </CardContent>

      <CardFooter className="mt-3 flex-wrap gap-1">
        <Label htmlFor={`move-type-${item.id}`} className="sr-only">
          Stock movement type for {item.name}
        </Label>
        <Select value={type} onValueChange={(v) => setType((v ?? "purchase") as MoveType)}>
          <SelectTrigger id={`move-type-${item.id}`} className="h-8 w-28 bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MOVE_LABELS) as MoveType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {MOVE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          step="0.001"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          placeholder="Qty"
          aria-label={`Quantity to record for ${item.name}`}
          className="h-8 w-16 bg-background text-right text-xs tabular-nums"
        />
        <Button size="sm" variant="secondary" disabled={pending || !delta} onClick={apply}>
          Apply
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onEdit}>
          Edit
        </Button>
      </CardFooter>
    </Card>
  )
}
