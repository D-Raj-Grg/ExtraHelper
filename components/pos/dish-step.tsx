"use client"

import { useMemo, useState } from "react"
import { ArmchairIcon, SearchIcon, ShoppingBagIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ALL_CATEGORIES, CategoryChips } from "@/components/pos/category-chips"
import { CartRail } from "@/components/pos/cart-rail"
import { DishGrid } from "@/components/pos/dish-grid"
import type { CheckIn } from "@/components/pos/check-in-details"
import type { CartController } from "@/components/pos/cart-types"
import type { PosCategory, PosCustomer, PosMenuItem, PosStaff } from "@/components/pos/types"

/**
 * Step 2: the dish grid and the cart, side by side on a counter and stacked on
 * a phone. Mode-blind — it takes a CartController and never asks what backs it.
 */
export function DishStep({
  menu,
  categories,
  cart,
  currency,
  destinationLabel,
  onChangeDestination,
  checkIn,
  onCheckInChange,
  customers,
  staff,
  showGuests,
  addDisabled = false,
  footer,
}: {
  menu: PosMenuItem[]
  categories: PosCategory[]
  cart: CartController
  currency: string
  destinationLabel: string
  /** Absent ⇒ the destination is fixed (amend mode: the order is already at a table). */
  onChangeDestination?: () => void
  checkIn: CheckIn
  onCheckInChange: (next: CheckIn) => void
  customers: PosCustomer[]
  staff: PosStaff[]
  showGuests: boolean
  addDisabled?: boolean
  footer: React.ReactNode
}) {
  const [search, setSearch] = useState("")
  const [categoryId, setCategoryId] = useState(ALL_CATEGORIES)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const item of menu) {
      if (!item.category_id) continue
      m.set(item.category_id, (m.get(item.category_id) ?? 0) + 1)
    }
    return m
  }, [menu])

  // Only offer categories that exist and hold something — a chip row of empty
  // filters is noise.
  const shownCategories = useMemo(
    () => categories.filter((c) => (counts.get(c.id) ?? 0) > 0),
    [categories, counts],
  )

  const isTakeaway = destinationLabel === "Takeaway"

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
          {onChangeDestination ? (
            <Button variant="outline" size="sm" onClick={onChangeDestination}>
              {isTakeaway ? <ShoppingBagIcon /> : <ArmchairIcon />}
              {destinationLabel}
              <span className="text-muted-foreground">· Change</span>
            </Button>
          ) : (
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              {isTakeaway ? (
                <ShoppingBagIcon className="size-4" aria-hidden />
              ) : (
                <ArmchairIcon className="size-4" aria-hidden />
              )}
              {destinationLabel}
            </span>
          )}

          <div className="relative ml-auto w-full sm:w-64">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label="Search dishes"
              placeholder="Search dishes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        {shownCategories.length > 0 ? (
          <div className="shrink-0 border-b px-3 py-2">
            <CategoryChips
              categories={shownCategories}
              value={categoryId}
              onChange={setCategoryId}
              counts={counts}
            />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <DishGrid
            menu={menu}
            categories={categories}
            cart={cart}
            currency={currency}
            search={search}
            categoryId={categoryId}
            disabled={addDisabled}
          />
        </div>
      </div>

      {/* Phone: a fixed share of the height, so the two panes split it instead
          of the rail taking its natural height and starving the grid — the grid
          is the thing a waiter actually taps. Both panes scroll internally.
          Counter: the rail becomes a fixed-width column and heights sort
          themselves out. */}
      <div className="flex min-h-0 shrink-0 basis-[45%] flex-col border-t lg:w-96 lg:basis-auto lg:border-t-0 lg:border-l">
        <CartRail
          cart={cart}
          currency={currency}
          checkIn={checkIn}
          onCheckInChange={onCheckInChange}
          customers={customers}
          staff={staff}
          showGuests={showGuests}
        />
        {footer}
      </div>
    </div>
  )
}
