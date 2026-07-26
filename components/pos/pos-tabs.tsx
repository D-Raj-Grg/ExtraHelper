"use client"

import { ChefHatIcon, ClipboardListIcon, LayoutGridIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

export type PosTab = "orders" | "table" | "kot"

const TABS: { key: PosTab; label: string; icon: typeof ClipboardListIcon }[] = [
  { key: "orders", label: "Orders", icon: ClipboardListIcon },
  { key: "table", label: "Table", icon: LayoutGridIcon },
  { key: "kot", label: "KOT", icon: ChefHatIcon },
]

/**
 * The three POS panes as one segmented control. Native radio group underneath —
 * arrow keys walk the set and a screen reader announces the selection — with a
 * count badge per tab so the board's shape reads before you switch to it.
 */
export function PosTabs({
  value,
  onChange,
  counts,
}: {
  value: PosTab
  onChange: (tab: PosTab) => void
  counts: Record<PosTab, number>
}) {
  return (
    <div
      role="radiogroup"
      aria-label="POS view"
      className="inline-flex gap-1 rounded-xl bg-muted p-1"
    >
      {TABS.map(({ key, label, icon: Icon }) => {
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
            {counts[key] > 0 ? (
              <Badge
                className={cn(
                  "border-transparent tabular-nums",
                  active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background",
                )}
              >
                {counts[key]}
              </Badge>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
