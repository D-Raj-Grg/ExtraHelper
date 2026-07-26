"use client"

import { cn } from "@/lib/utils"
import type { PosMenuItem } from "@/components/pos/types"

/**
 * Initials for the placeholder — "Buff Sekuwa" → "BS", "Aila (per shot)" → "A".
 * Parenthetical qualifiers are noise here, so they're dropped before picking.
 */
export function monogram(name: string): string {
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
 * A dish's photo, or a designed absence when it has none.
 *
 * Shared by the tile and the options dialog so "what a photoless dish looks
 * like" is decided once — a second placeholder that drifted from this one would
 * be obvious the moment they sat next to each other.
 */
export function DishThumb({
  item,
  className,
  monogramClassName,
  grayscale = false,
}: {
  item: Pick<PosMenuItem, "name" | "image_url">
  className?: string
  monogramClassName?: string
  grayscale?: boolean
}) {
  if (item.image_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.image_url}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn("size-full object-cover", grayscale && "grayscale", className)}
      />
    )
  }
  return (
    <span className={cn("flex size-full items-center justify-center bg-muted", className)}>
      <span
        className={cn(
          "font-bold tracking-tight text-muted-foreground/50 tabular-nums",
          monogramClassName ?? "text-3xl",
        )}
      >
        {monogram(item.name)}
      </span>
    </span>
  )
}
