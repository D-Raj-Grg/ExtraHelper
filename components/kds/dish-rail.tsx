"use client"

import { useMemo, useState } from "react"
import { SearchIcon } from "lucide-react"

import { KOT_FLOW, KOT_STATUS_META, kotStatusLabel } from "@/lib/kds-constants"
import { cn } from "@/lib/utils"
import { isLive, type KdsKot } from "@/components/kds/types"
import { StatusIcon } from "@/components/kds/status-icon"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

type DishRow = {
  name: string
  total: number
  /** qty per status, in KOT_FLOW order */
  byStatus: Map<string, number>
}

/**
 * All-day totals, by dish. The board answers "what does this table need"; this
 * answers "how many coffees am I making tonight" — the question a cook asks
 * when batching. Counts are quantities, not lines, and each status carries an
 * icon so the breakdown is readable in grayscale.
 */
export function DishRail({ kots }: { kots: KdsKot[] }) {
  const [query, setQuery] = useState("")

  const dishes = useMemo(() => {
    const rows = new Map<string, DishRow>()
    for (const kot of kots) {
      for (const line of kot.kot_items) {
        if (!isLive(line)) continue
        const name = line.order_items?.name_snapshot ?? "item"
        let row = rows.get(name)
        if (!row) {
          row = { name, total: 0, byStatus: new Map() }
          rows.set(name, row)
        }
        row.total += line.qty
        row.byStatus.set(line.status, (row.byStatus.get(line.status) ?? 0) + line.qty)
      }
    }
    return [...rows.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  }, [kots])

  const q = query.trim().toLowerCase()
  const visible = q ? dishes.filter((d) => d.name.toLowerCase().includes(q)) : dishes
  const totalDishes = dishes.reduce((n, d) => n + d.total, 0)

  return (
    <aside aria-label="Dishes on the board" className="flex flex-col gap-3 rounded-xl border bg-card/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-base font-semibold">Dish list</h2>
        <Badge className="border-transparent bg-amber-500/10 text-amber-700 tabular-nums dark:text-amber-400">
          {totalDishes} to cook
        </Badge>
      </div>

      {dishes.length > 0 ? (
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search dishes"
            aria-label="Search dishes"
            className="h-11 pl-9"
          />
        </div>
      ) : null}

      {dishes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nothing on the pass. Fired dishes are counted here so you can batch them.
        </p>
      ) : visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No dish matches &ldquo;{query}&rdquo;. Clear the search to see all {dishes.length}.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((dish) => (
            <li key={dish.name} className="rounded-lg border bg-card p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-base font-semibold">{dish.name}</span>
                <span className="shrink-0 text-base font-bold tabular-nums">×{dish.total}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {KOT_FLOW.filter((s) => dish.byStatus.get(s)).map((s) => (
                  <span
                    key={s}
                    className={cn(
                      "flex items-center gap-1 text-xs font-medium",
                      KOT_STATUS_META[s].tone,
                    )}
                  >
                    <StatusIcon status={s} className="size-3.5" />
                    <span className="tabular-nums">{dish.byStatus.get(s)}</span>
                    {kotStatusLabel(s)}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
