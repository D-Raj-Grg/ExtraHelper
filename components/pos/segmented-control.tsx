"use client"

import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

export type SegmentedItem<K extends string> = {
  key: K
  label: string
  icon: LucideIcon
  /** Omit where a number would be noise — a badge here reads as "work waiting". */
  count?: number
}

/**
 * One choice out of a few, as a segmented control. Native radio group
 * underneath — arrow keys walk the set and a screen reader announces the
 * selection — with an optional count badge per segment.
 *
 * Extracted from PosTabs when the KOT tab needed the same Active|Completed
 * shape: two hand-rolled versions of one control is exactly the drift the
 * design system forbids.
 */
export function SegmentedControl<K extends string>({
  value,
  onChange,
  items,
  ariaLabel,
}: {
  value: K
  onChange: (key: K) => void
  items: SegmentedItem<K>[]
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex gap-1 rounded-xl bg-muted p-1"
    >
      {items.map(({ key, label, icon: Icon, count }) => {
        const active = value === key
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(key)}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
            {count ? (
              <Badge
                className={cn(
                  // Both cases set their own text colour: the default variant's
                  // white foreground on a light `bg-background` pill was an
                  // invisible count.
                  "min-w-5 border-transparent px-1.5 font-semibold tabular-nums",
                  active
                    ? "bg-primary-foreground/25 text-primary-foreground"
                    : "bg-background text-foreground shadow-xs",
                )}
              >
                {count}
              </Badge>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
