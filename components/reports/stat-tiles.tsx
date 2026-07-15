import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { Delta } from "@/lib/report-range"

export type Tile = {
  label: string
  value: string
  delta?: Delta
  /** Draws attention to a number that isn't neutral news (voids, refunds). */
  warn?: boolean
}

/**
 * The metric row at the top of a report tab. Deltas carry an icon as well as
 * colour so the direction survives a colourblind reading.
 */
export function StatTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {tiles.map((t) => (
        <Card key={t.label} size="sm">
          <CardHeader>
            <CardDescription className="text-xs">{t.label}</CardDescription>
            <CardTitle
              className={cn(
                "text-xl tabular-nums",
                t.warn && "text-amber-600 dark:text-amber-400",
              )}
            >
              {t.value}
            </CardTitle>
            {t.delta ? <DeltaLabel delta={t.delta} /> : null}
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

function DeltaLabel({ delta }: { delta: NonNullable<Delta> }) {
  const Icon =
    delta.dir === "down" ? TrendingDownIcon : delta.dir === "new" ? MinusIcon : TrendingUpIcon
  return (
    <p
      className={cn(
        "flex items-center gap-1 text-xs tabular-nums",
        delta.dir === "down"
          ? "text-destructive"
          : delta.dir === "new"
            ? "text-muted-foreground"
            : "text-emerald-600 dark:text-emerald-400",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {delta.text}
      <span className="text-muted-foreground">vs prev</span>
    </p>
  )
}
