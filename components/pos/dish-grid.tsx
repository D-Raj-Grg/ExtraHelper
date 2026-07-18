"use client"

import { useMemo, useState } from "react"

import { MenuTile } from "@/components/pos/menu-tile"
import { ItemOptionsDialog } from "@/components/pos/item-options-dialog"
import { ALL_CATEGORIES } from "@/components/pos/category-chips"
import { draftUnitPrice, type CartController } from "@/components/pos/cart-types"
import type { PosCategory, PosMenuItem } from "@/components/pos/types"

function optionCount(item: PosMenuItem): number {
  return (item.variants?.length ?? 0) + (item.modifiers?.length ?? 0)
}

/**
 * The dish grid. Filters by search + category, and either adds straight to the
 * cart or opens the options picker when a dish has any.
 */
export function DishGrid({
  menu,
  categories,
  cart,
  currency,
  search,
  categoryId,
  disabled = false,
}: {
  menu: PosMenuItem[]
  categories: PosCategory[]
  cart: CartController
  currency: string
  search: string
  categoryId: string
  disabled?: boolean
}) {
  // Held by id, not by object: the menu list is replaced wholesale on every
  // Realtime refresh (an 86 toggle), and a stored object would pin the dialog
  // to a stale copy.
  const [openId, setOpenId] = useState<string | null>(null)

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return menu.filter((m) => {
      if (categoryId !== ALL_CATEGORIES && m.category_id !== categoryId) return false
      return !q || m.name.toLowerCase().includes(q)
    })
  }, [menu, search, categoryId])

  // Derived from the live list, so an 86 mid-order updates the open dialog too.
  const openItem = openId ? (menu.find((m) => m.id === openId) ?? null) : null

  // Plain lookup, no useMemo: a find over a handful of categories, and hand-
  // memoizing it on `openItem?.category_id` reads as a narrower dependency than
  // the compiler infers, which makes it bail out of optimizing this component
  // altogether. Let the compiler do it.
  const categoryName = openItem?.category_id
    ? (categories.find((c) => c.id === openItem.category_id)?.name ?? null)
    : null

  const qtyFor = (itemId: string) =>
    cart.lines.reduce((sum, l) => (l.itemId === itemId ? sum + l.qty : sum), 0)

  if (shown.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {search.trim()
          ? `Nothing matching “${search.trim()}”. Try a shorter word, or clear the search.`
          : "No dishes in this category yet."}
      </p>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {shown.map((item) => (
          <MenuTile
            key={item.id}
            item={item}
            qty={qtyFor(item.id)}
            currency={currency}
            disabled={disabled}
            optionCount={optionCount(item)}
            expanded={openId === item.id}
            onAdd={() => {
              if (optionCount(item) > 0) {
                setOpenId(item.id)
                return
              }
              cart.add({
                itemId: item.id,
                name: item.name,
                variantId: null,
                variantName: null,
                modifierIds: [],
                modifierNames: [],
                notes: null,
                course: null,
                seat: null,
                qty: 1,
                unitPriceCents: draftUnitPrice(item, null, []),
              })
            }}
          />
        ))}
      </div>

      <ItemOptionsDialog
        item={openItem}
        categoryName={categoryName}
        currency={currency}
        open={openId !== null}
        onOpenChange={(o) => setOpenId(o ? openId : null)}
        onAdd={cart.add}
      />
    </>
  )
}
