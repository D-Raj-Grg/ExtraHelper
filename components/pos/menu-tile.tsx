"use client"

import { SlidersHorizontalIcon } from "lucide-react"
import { moneyRange } from "@/lib/format"
import { cn } from "@/lib/utils"
import { itemPriceRange } from "@/components/pos/cart-types"
import { DishThumb } from "@/components/pos/dish-thumb"
import { VegMark } from "@/components/pos/veg-mark"
import type { PosMenuItem } from "@/components/pos/types"

/**
 * One tappable dish. Photo-first: staff recognise a dish by its picture faster
 * than by reading it, so the image leads and the name/price sit under it. The
 * whole tile is the target — never a small button inside a card.
 */
export function MenuTile({
  item,
  qty,
  currency,
  onAdd,
  disabled = false,
  optionCount = 0,
  expanded = false,
}: {
  item: PosMenuItem
  qty: number
  currency: string
  onAdd: () => void
  /** The order is fired/billed — the menu is visible but no longer addable. */
  disabled?: boolean
  /**
   * How many variants + add-ons this dish has. Above zero, tapping opens the
   * picker instead of adding straight away, and the count is shown — "3 options"
   * tells a waiter whether it's worth the tap; a bare "options" doesn't.
   */
  optionCount?: number
  expanded?: boolean
}) {
  const hasOptions = optionCount > 0
  const inCart = qty > 0
  const soldOut = item.is_86
  const off = soldOut || disabled

  // What this dish can actually cost. Not base_price_cents: with variants the
  // picker forces a choice, so the base price alone is a figure no one can
  // order — which is what this tile used to advertise.
  const { min, max } = itemPriceRange(item)
  const priceText = moneyRange(min, max, currency)
  const isRange = min !== max

  return (
    <button
      type="button"
      disabled={off}
      onClick={onAdd}
      aria-expanded={hasOptions ? expanded : undefined}
      aria-label={`${hasOptions ? "Choose options for" : "Add"} ${item.name}, ${priceText}${
        item.is_veg === true ? ", vegetarian" : item.is_veg === false ? ", non-vegetarian" : ""
      }${soldOut ? ", sold out" : ""}${inCart ? `, ${qty} in order` : ""}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border-2 bg-card text-left",
        "transition-[border-color,transform] duration-150 ease-out motion-reduce:transition-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        inCart || expanded ? "border-primary" : "border-border",
        off
          ? "cursor-not-allowed opacity-60"
          : "hover:border-ring/60 active:scale-[0.98] motion-reduce:active:scale-100",
      )}
    >
      <span className="relative block aspect-[4/3] w-full overflow-hidden bg-muted">
        <DishThumb
          item={item}
          grayscale={soldOut}
          className={cn(
            // Fixed aspect box above means this can't shift layout.
            item.image_url && "transition-transform duration-200 ease-out motion-reduce:transition-none",
            item.image_url && !off && "group-hover:scale-[1.03]",
          )}
        />

        {soldOut ? (
          <span className="absolute inset-x-0 bottom-0 bg-destructive px-2 py-1 text-center text-xs font-bold uppercase tracking-wide text-white">
            Sold out
          </span>
        ) : null}

        {inCart ? (
          <span className="absolute top-2 right-2 flex min-h-7 min-w-7 items-center justify-center rounded-full bg-primary px-2 text-sm font-bold tabular-nums text-primary-foreground shadow-sm">
            {qty}
          </span>
        ) : null}

        {/* Sizes/add-ons were only hinted at by the grey word "options"; an icon
            reads at a glance and survives a rush. */}
        {hasOptions && !soldOut ? (
          <span
            aria-hidden
            className="absolute top-2 left-2 flex size-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm"
          >
            <SlidersHorizontalIcon className="size-3.5" />
          </span>
        ) : null}
      </span>

      <span className="flex flex-1 flex-col gap-0.5 p-3">
        <span className="flex items-start gap-1.5">
          {/* Beside the name rather than on the photo: both image corners are
              already taken, and this is where /menu shows it too. */}
          <VegMark isVeg={item.is_veg} className="mt-0.5" />
          <span className="line-clamp-2 text-sm leading-snug font-semibold">{item.name}</span>
        </span>
        <span
          className={cn(
            "mt-auto flex flex-wrap items-center gap-x-1.5 font-medium tabular-nums text-muted-foreground",
            // A full range is long for a narrow tile; drop a step so it fits.
            isRange ? "text-xs" : "text-sm",
          )}
        >
          {priceText}
          {hasOptions && !soldOut ? (
            <span className="text-xs font-normal">
              · {optionCount} {optionCount === 1 ? "option" : "options"}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}
