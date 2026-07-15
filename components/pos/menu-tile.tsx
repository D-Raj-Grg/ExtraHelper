"use client"

import { SlidersHorizontalIcon } from "lucide-react"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CachedMenuItem } from "@/lib/offline/menu-cache"

/**
 * Initials for the placeholder — "Buff Sekuwa" → "BS", "Aila (per shot)" → "A".
 * Parenthetical qualifiers are noise here, so they're dropped before picking.
 */
function monogram(name: string): string {
  const words = name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w))
  if (words.length === 0) return "?"
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

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
  hasOptions = false,
  expanded = false,
}: {
  item: CachedMenuItem
  qty: number
  currency: string
  onAdd: () => void
  /** The order is fired/billed — the menu is visible but no longer addable. */
  disabled?: boolean
  /** Tapping opens the variant/add-on picker rather than adding straight away. */
  hasOptions?: boolean
  expanded?: boolean
}) {
  const inCart = qty > 0
  const soldOut = item.is_86
  const off = soldOut || disabled

  return (
    <button
      type="button"
      disabled={off}
      onClick={onAdd}
      aria-expanded={hasOptions ? expanded : undefined}
      aria-label={`${hasOptions ? "Choose options for" : "Add"} ${item.name}, ${money(
        item.base_price_cents,
        currency,
      )}${soldOut ? ", sold out" : ""}${inCart ? `, ${qty} in order` : ""}`}
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
        {item.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image_url}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn(
              "size-full object-cover",
              soldOut && "grayscale",
              // Fixed aspect box above means this can't shift layout.
              "transition-transform duration-200 ease-out motion-reduce:transition-none",
              !off && "group-hover:scale-[1.03]",
            )}
          />
        ) : (
          // A designed absence, not a broken image: the dish's initials, big.
          <span className="flex size-full items-center justify-center">
            <span className="text-3xl font-bold tracking-tight text-muted-foreground/50 tabular-nums">
              {monogram(item.name)}
            </span>
          </span>
        )}

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
        <span className="line-clamp-2 text-sm leading-snug font-semibold">{item.name}</span>
        <span className="mt-auto flex items-center gap-1.5 text-sm font-medium tabular-nums text-muted-foreground">
          {money(item.base_price_cents, currency)}
          {hasOptions && !soldOut ? (
            <span className="text-xs font-normal">· options</span>
          ) : null}
        </span>
      </span>
    </button>
  )
}
