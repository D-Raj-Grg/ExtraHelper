"use client"

import { MinusIcon, PlusIcon, SlidersHorizontalIcon } from "lucide-react"

import { moneyRange } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DishThumb } from "@/components/pos/dish-thumb"
import { VegMark } from "@/components/pos/veg-mark"
import { qrItemPriceRange, type QrItem } from "@/components/qr/qr-menu-types"

/**
 * One dish on the guest menu.
 *
 * A row, not the POS tile: a diner scans a long menu top-to-bottom looking for
 * a name and a price, and 86 four-by-three photos means a lot of scrolling to
 * see fifteen dishes. The photo still leads the row, because it is what sells
 * the food — it just doesn't own the whole width.
 *
 * The price is `foreground`, not muted. It was the same grey as the
 * description, which is exactly backwards: it is the second thing a guest
 * reads.
 */
export function DishRow({
  item,
  qty,
  currency,
  onAdd,
  onRemove,
  hidden = false,
}: {
  item: QrItem
  /** Total across every size of this dish that's in the order. */
  qty: number
  currency: string
  /** Opens the size picker when the dish has variants; adds straight away otherwise. */
  onAdd: () => void
  /** Only wired when exactly one line of this dish exists — see MenuBrowser. */
  onRemove?: () => void
  /**
   * Filtered out by search or the category chips. Hidden rather than
   * unmounted: `hidden` is display:none, so it leaves layout and the a11y tree
   * as an unmount would, but the decoded photo survives — switching category
   * on a 86-dish menu stops re-fetching every image.
   */
  hidden?: boolean
}) {
  const { min, max } = qrItemPriceRange(item)
  const sizes = item.variants?.length ?? 0
  const priceText = moneyRange(min, max, currency)
  const inOrder = qty > 0

  return (
    <li
      hidden={hidden}
      className={cn(
        "flex items-stretch gap-3 rounded-xl border-2 bg-card p-2.5",
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
        inOrder ? "border-primary" : "border-border",
        hidden && "hidden",
      )}
    >
      <span className="relative block size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
        <DishThumb item={item} monogramClassName="text-xl" />
        {inOrder ? (
          <span className="absolute top-1 right-1 flex min-h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold tabular-nums text-primary-foreground shadow-sm">
            {qty}
          </span>
        ) : null}
      </span>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <p className="flex items-start gap-1.5 leading-snug font-semibold">
          <VegMark isVeg={item.is_veg} className="mt-1" />
          <span className="min-w-0">{item.name}</span>
        </p>
        {item.description ? (
          <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{item.description}</p>
        ) : null}
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold tabular-nums">
          {/* A range means the guest picks a size next; say so in words, not
              by the dash alone. */}
          {min !== max ? <span className="text-xs font-normal text-muted-foreground">From</span> : null}
          <span>{min !== max ? moneyRange(min, min, currency) : priceText}</span>
          {sizes > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <SlidersHorizontalIcon aria-hidden className="size-3" />
              {sizes} {sizes === 1 ? "size" : "sizes"}
            </span>
          ) : null}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 self-center">
        {onRemove ? (
          <Button
            size="icon"
            variant="outline"
            className="size-11"
            onClick={onRemove}
            aria-label={`Remove one ${item.name}`}
          >
            <MinusIcon />
          </Button>
        ) : null}
        <Button
          size="icon"
          className="size-11"
          onClick={onAdd}
          aria-label={
            sizes > 0
              ? `Choose a size for ${item.name}, from ${moneyRange(min, min, currency)}`
              : `Add ${item.name}, ${priceText}`
          }
        >
          <PlusIcon />
        </Button>
      </div>
    </li>
  )
}
