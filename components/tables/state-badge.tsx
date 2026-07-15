import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { tableStateLabel } from "@/lib/table-constants"

/** Pill colouring (grid view). Same hue per state as the floor map. */
const STATE_STYLES: Record<string, string> = {
  free: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  occupied: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  reserved: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  bill_requested: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  cleaning: "bg-muted text-muted-foreground",
}

/** Node colouring (floor map) — same hues, with a border to read as a solid. */
export const MAP_STATE_STYLES: Record<string, string> = {
  free: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/40",
  occupied: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40",
  reserved: "bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-500/40",
  bill_requested: "bg-orange-500/15 text-orange-800 dark:text-orange-300 border-orange-500/40",
  cleaning: "bg-muted text-muted-foreground border-border",
}

export function mapStateStyle(state: string): string {
  return MAP_STATE_STYLES[state] ?? MAP_STATE_STYLES.cleaning
}

export function StateBadge({ state }: { state: string }) {
  return (
    <Badge className={cn("border-transparent", STATE_STYLES[state] ?? STATE_STYLES.cleaning)}>
      {tableStateLabel(state)}
    </Badge>
  )
}
