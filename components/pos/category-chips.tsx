"use client"

import { ChoiceChip } from "@/components/pos/choice-chip"
import type { PosCategory } from "@/components/pos/types"

export const ALL_CATEGORIES = "__all__"

/**
 * Category filter for the dish grid. Only rendered when a tenant actually has
 * categories — a lone "All" chip is furniture, not a filter.
 */
export function CategoryChips({
  categories,
  value,
  onChange,
  counts,
}: {
  categories: PosCategory[]
  value: string
  onChange: (id: string) => void
  /** Dishes per category id, so an empty chip can say so before it's tapped. */
  counts: Map<string, number>
}) {
  if (categories.length === 0) return null

  const total = [...counts.values()].reduce((a, b) => a + b, 0)

  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Filter by category</legend>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <ChoiceChip
          name="pos-category"
          checked={value === ALL_CATEGORIES}
          onSelect={() => onChange(ALL_CATEGORIES)}
          label="All"
          detail={`${total} ${total === 1 ? "dish" : "dishes"}`}
          className="shrink-0"
        />
        {categories.map((c) => {
          const n = counts.get(c.id) ?? 0
          return (
            <ChoiceChip
              key={c.id}
              name="pos-category"
              checked={value === c.id}
              onSelect={() => onChange(c.id)}
              disabled={n === 0}
              label={c.name}
              detail={`${n} ${n === 1 ? "dish" : "dishes"}`}
              className="shrink-0"
            />
          )
        })}
      </div>
    </fieldset>
  )
}
