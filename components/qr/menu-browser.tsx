"use client"

import { useMemo, useState } from "react"
import { SearchIcon, XIcon } from "lucide-react"

import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChoiceChip } from "@/components/pos/choice-chip"
import { DishRow } from "@/components/qr/dish-row"
import { DishOptionsDialog } from "@/components/qr/dish-options-dialog"
import {
  cartCount,
  cartTotal,
  itemMatches,
  type QrCartLine,
  type QrCategory,
  type QrItem,
} from "@/components/qr/qr-menu-types"

const ALL = "__all__"

/**
 * The guest menu: find a dish, add it, see what you've picked.
 *
 * Sekuwa Station's menu is 86 dishes across 13 categories. As one flat scroll
 * with no search, finding a beer meant thumbing past sixty plates of food — so
 * search and category chips are the frame, not an enhancement. Filtering hides
 * rows rather than unmounting them, which keeps every decoded photo alive
 * across a category switch (`DishRow`'s `hidden` explains why).
 */
export function MenuBrowser({
  categories,
  currency,
  lines,
  onAdd,
  onSetQty,
  onReview,
}: {
  categories: QrCategory[]
  currency: string
  lines: QrCartLine[]
  onAdd: (item: QrItem, variantId: string | null, qty: number) => void
  onSetQty: (key: string, qty: number) => void
  /** Opens the review sheet — the summary bar is a button, not a label. */
  onReview: () => void
}) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState(ALL)
  const [optionsFor, setOptionsFor] = useState<QrItem | null>(null)

  // Which dishes survive the current search + chip, and how many of each are
  // already in the order. Recomputed per keystroke over ~86 items — cheap, and
  // it keeps every row's state in one place.
  const { visible, perCategory, totalVisible } = useMemo(() => {
    const visible = new Set<string>()
    const perCategory = new Map<string, number>()
    for (const cat of categories) {
      let n = 0
      for (const item of cat.items) {
        if (!itemMatches(item, cat.name, query)) continue
        n += 1
        if (category === ALL || category === cat.id) visible.add(item.id)
      }
      perCategory.set(cat.id, n)
    }
    return { visible, perCategory, totalVisible: visible.size }
  }, [categories, query, category])

  const qtyByItem = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lines) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty)
    return m
  }, [lines])

  const count = cartCount(lines)
  const total = cartTotal(lines)

  function add(item: QrItem) {
    if ((item.variants?.length ?? 0) > 0) {
      setOptionsFor(item)
      return
    }
    onAdd(item, null, 1)
  }

  /**
   * Minus on a row only when that dish is in the order exactly once, at one
   * size — "remove one" is ambiguous the moment a guest has both a Half Kg and
   * a 1 Kg, and guessing which to take away is worse than sending them to the
   * review list.
   */
  function removerFor(item: QrItem) {
    const own = lines.filter((l) => l.itemId === item.id)
    if (own.length !== 1) return undefined
    const line = own[0]
    return () => onSetQty(line.key, line.qty - 1)
  }

  return (
    <>
      {/* Sticky, because a 86-dish scroll leaves search off-screen instantly. */}
      <div className="sticky top-0 z-20 -mx-4 mb-3 space-y-2 border-b bg-background/95 px-4 pt-3 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the menu — momo, beer, veg…"
            aria-label="Search the menu"
            className="h-11 pr-10 pl-9"
          />
          {query ? (
            <Button
              size="icon"
              variant="ghost"
              className="absolute top-1/2 right-1 size-9 -translate-y-1/2"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <XIcon />
            </Button>
          ) : null}
        </div>

        <fieldset className="min-w-0">
          <legend className="sr-only">Jump to a section</legend>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <ChoiceChip
              name="qr-category"
              checked={category === ALL}
              onSelect={() => setCategory(ALL)}
              label="All"
              className="shrink-0"
            />
            {categories.map((c) => {
              const n = perCategory.get(c.id) ?? 0
              return (
                <ChoiceChip
                  key={c.id}
                  name="qr-category"
                  checked={category === c.id}
                  onSelect={() => setCategory(c.id)}
                  disabled={n === 0}
                  label={c.name}
                  className="shrink-0"
                />
              )
            })}
          </div>
        </fieldset>
      </div>

      {totalVisible === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="font-medium">Nothing matches “{query}”</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try a shorter word, or browse a section above. Your server can help too.
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              setQuery("")
              setCategory(ALL)
            }}
          >
            Show the whole menu
          </Button>
        </div>
      ) : null}

      <div className={cn(count > 0 ? "pb-28" : "pb-6")}>
        {categories.map((cat) => {
          const shown = cat.items.filter((i) => visible.has(i.id))
          return (
            <section key={cat.id} hidden={shown.length === 0} className="mb-6">
              <h2 className="mb-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
                {cat.name}
              </h2>
              <ul className="flex flex-col gap-2">
                {cat.items.map((item) => (
                  <DishRow
                    key={item.id}
                    item={item}
                    currency={currency}
                    qty={qtyByItem.get(item.id) ?? 0}
                    hidden={!visible.has(item.id)}
                    onAdd={() => add(item)}
                    onRemove={removerFor(item)}
                  />
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      <DishOptionsDialog
        item={optionsFor}
        currency={currency}
        open={optionsFor !== null}
        onOpenChange={(open) => {
          if (!open) setOptionsFor(null)
        }}
        onAdd={(variantId, qty) => {
          if (optionsFor) onAdd(optionsFor, variantId, qty)
        }}
      />

      {count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80">
          {/* 64px: this is the one control every guest ends up pressing, often
              one-handed with a phone flat on a table — and it competes with the
              home-bar gesture area, hence the safe-area padding above. */}
          <Button className="h-16 w-full justify-between px-4 text-base font-semibold" onClick={onReview}>
            <span>
              Review order · {count} {count === 1 ? "item" : "items"}
            </span>
            <span className="tabular-nums">{money(total, currency)}</span>
          </Button>
        </div>
      ) : null}
    </>
  )
}
