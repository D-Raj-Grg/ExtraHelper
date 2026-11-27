"use client"

import { useMemo, useState } from "react"

import { MenuTile } from "@/components/pos/menu-tile"
import { ItemOptionsDialog } from "@/components/pos/item-options-dialog"
import { ALL_CATEGORIES } from "@/components/pos/category-chips"
import { rankMatches } from "@/lib/menu-search"
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

  // A set of ids rather than a filtered list: every tile stays mounted and the
  // filtered-out ones are hidden. Dropping them from the tree unmounts their
  // <img>, and coming back re-creates it — the photo blanks and re-decodes on
  // every category tap, which is the flicker. Keeping them mounted keeps the
  // decoded image alive for the life of the screen.
  //
  // A search looks across every category: someone typing "coke" while the Hard
  // Drinks chip is selected wants Coke, not an empty grid and a hunt for the
  // right chip. The chip only narrows the browse view. Matches come back best
  // first, and the tiles are rendered in that order (not re-ordered with CSS),
  // so tab order follows what the eye sees.
  const searching = search.trim().length > 0
  const { shown, ordered } = useMemo(() => {
    const ids = new Set<string>()
    if (!searching) {
      for (const m of menu) {
        if (categoryId !== ALL_CATEGORIES && m.category_id !== categoryId) continue
        ids.add(m.id)
      }
      return { shown: ids, ordered: menu }
    }
    const categoryName = new Map(categories.map((c) => [c.id, c.name]))
    const ranked = rankMatches(menu, search, (m) => ({
      name: m.name,
      extras: [
        ...(m.variants ?? []).map((v) => v.name),
        ...(m.category_id && categoryName.has(m.category_id) ? [categoryName.get(m.category_id)!] : []),
      ],
    }))
    for (const m of ranked) ids.add(m.id)
    // Matches first, in rank order; everything else stays mounted (hidden) after.
    return { shown: ids, ordered: [...ranked, ...menu.filter((m) => !ids.has(m.id))] }
  }, [menu, categories, search, searching, categoryId])

  // The chip is ignored while searching — say so when that changes what's on screen.
  const selectedCategoryName =
    categoryId === ALL_CATEGORIES ? null : (categories.find((c) => c.id === categoryId)?.name ?? null)
  const crossedCategories =
    searching && selectedCategoryName !== null && menu.some((m) => shown.has(m.id) && m.category_id !== categoryId)

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

  return (
    <>
      {/* Alongside the grid rather than instead of it: an early return here
          would unmount every tile — and every loaded photo with it — the moment
          a search went one keystroke too far. */}
      {shown.size === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {searching
            ? `Nothing matching “${search.trim()}” in any category. Check the spelling, try the first few letters, or clear the search.`
            : "No dishes in this category yet."}
        </p>
      ) : null}

      {crossedCategories ? (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          Showing {shown.size} {shown.size === 1 ? "match" : "matches"} from <strong>all categories</strong>, not
          just {selectedCategoryName}.
        </p>
      ) : null}

      {/* Sized by the space it is in, not by the window. Breakpoints measure the
          viewport, but this grid sits in a pane that is the viewport minus a
          384px cart rail — so `xl:grid-cols-5` handed five columns' worth of
          dishes to a pane with room for three, and at a larger text size the
          row stopped fitting and pushed the rail off the dialog's edge.
          auto-fill counts the columns itself: ~9rem is a comfortable tap target
          for a photo tile, and the count falls out of whatever width there is. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
        {ordered.map((item) => (
          <MenuTile
            key={item.id}
            item={item}
            qty={qtyFor(item.id)}
            currency={currency}
            disabled={disabled}
            hidden={!shown.has(item.id)}
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
