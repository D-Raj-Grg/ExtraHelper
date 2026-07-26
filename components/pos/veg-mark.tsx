"use client"

import { cn } from "@/lib/utils"

/**
 * The veg / non-veg mark used across South Asia.
 *
 * **The shape carries the meaning; the colour only reinforces it.** A green dot
 * vs a red dot would be indistinguishable to the most common colourblindness —
 * and "never colour alone" is a house rule for exactly this reason. So veg is a
 * circle and non-veg a triangle, which is also what the real convention does.
 * Both still read in greyscale.
 *
 * `null`/`undefined` renders nothing: a dish nobody has marked must not be
 * guessed at. Mislabelling food is worse than not labelling it.
 */
export function VegMark({
  isVeg,
  className,
}: {
  isVeg?: boolean | null
  className?: string
}) {
  if (isVeg === null || isVeg === undefined) return null

  const label = isVeg ? "Vegetarian" : "Non-vegetarian"

  return (
    <span
      title={label}
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
        isVeg ? "border-emerald-600 dark:border-emerald-500" : "border-destructive",
        className,
      )}
    >
      {isVeg ? (
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-emerald-600 dark:bg-emerald-500"
        />
      ) : (
        // A triangle, not a dot — this is the bit that survives greyscale.
        <span
          aria-hidden
          className="size-0 border-x-[3px] border-b-[5px] border-x-transparent border-b-destructive"
        />
      )}
      <span className="sr-only">{label}</span>
    </span>
  )
}
