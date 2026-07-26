"use client"

import { ShoppingBagIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { tableStateLabel } from "@/lib/table-constants"
import { ChoiceChip } from "@/components/pos/choice-chip"
import { TableGlyph } from "@/components/pos/table-glyph"
import { TAKEAWAY, type PosFloor, type PosTable } from "@/components/pos/types"

/** One state, one hue, app-wide — same map the floor map and tables grid use. */
const STATE_DOT: Record<string, string> = {
  free: "bg-emerald-500",
  occupied: "bg-amber-500",
  reserved: "bg-blue-500",
  bill_requested: "bg-orange-500",
  cleaning: "bg-muted-foreground/40",
}

/** The glyph tint per state — muted on an unselected chip, inherited when selected. */
const STATE_GLYPH: Record<string, string> = {
  free: "text-emerald-600 dark:text-emerald-400",
  occupied: "text-amber-600 dark:text-amber-400",
  reserved: "text-blue-600 dark:text-blue-400",
  bill_requested: "text-orange-600 dark:text-orange-400",
  cleaning: "text-muted-foreground",
}

/** A seated table is one the glyph fills in — same rule as the tables board. */
const SEATED = new Set(["occupied", "bill_requested"])

const NO_FLOOR = "__none__"

/**
 * Auto-fill, not a fixed column count: a floor with one table gets one
 * chip-sized chip instead of one stretched across the whole dialog, and a floor
 * with twenty packs them without the layout being re-tuned per breakpoint.
 */
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2"

function floorLabel(floors: PosFloor[], id: string): string {
  if (id === NO_FLOOR) return floors.length ? "Unassigned" : "Tables"
  return floors.find((f) => f.id === id)?.name ?? "Tables"
}

/**
 * Step 1: where is this order going?
 *
 * Grouped by floor because "Table 4" means nothing on its own once a venue has
 * two of them. One radio group across every chip, so arrow keys walk the whole
 * set rather than stopping at a floor boundary.
 */
export function DestinationStep({
  tables,
  floors,
  value,
  onChange,
}: {
  tables: PosTable[]
  floors: PosFloor[]
  value: string
  onChange: (id: string) => void
}) {
  const groups = new Map<string, PosTable[]>()
  for (const t of tables) {
    const key = t.floor_id ?? NO_FLOOR
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }
  // Floor order, then any table whose floor was deleted.
  const ordered = [
    ...floors.filter((f) => groups.has(f.id)).map((f) => f.id),
    ...(groups.has(NO_FLOOR) ? [NO_FLOOR] : []),
  ]

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Takeaway
        </legend>
        <div className={GRID}>
          <ChoiceChip
            name="pos-destination"
            checked={value === TAKEAWAY}
            onSelect={() => onChange(TAKEAWAY)}
            label="Takeaway"
            detail="No table"
            showCheck
            leading={<ShoppingBagIcon className="size-6 shrink-0" aria-hidden />}
          />
        </div>
      </fieldset>

      {tables.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tables yet — this order can still go out as takeaway. Add tables under Table &amp; Space
          to seat guests.
        </p>
      ) : (
        ordered.map((floorId) => (
          <fieldset key={floorId}>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {floorLabel(floors, floorId)}
            </legend>
            <div className={GRID}>
              {(groups.get(floorId) ?? []).map((t) => {
                const selected = value === t.id
                return (
                  <ChoiceChip
                    key={t.id}
                    name="pos-destination"
                    checked={selected}
                    onSelect={() => onChange(t.id)}
                    label={`Table ${t.label}`}
                    showCheck
                    // Same top-down glyph as the tables board, so a table looks
                    // like the same object in both places. Seat count is drawn,
                    // not just written.
                    leading={
                      <TableGlyph
                        seats={t.capacity ?? 2}
                        filled={SEATED.has(t.state)}
                        className={cn(
                          "size-8 shrink-0",
                          !selected && (STATE_GLYPH[t.state] ?? STATE_GLYPH.cleaning),
                        )}
                      />
                    }
                    // The dot is never the only signal — the state is spelled out
                    // next to it, and seats give the host the other half.
                    detail={
                      t.capacity
                        ? `${tableStateLabel(t.state)} · ${t.capacity} seats`
                        : tableStateLabel(t.state)
                    }
                    dot={STATE_DOT[t.state] ?? STATE_DOT.cleaning}
                  />
                )
              })}
            </div>
          </fieldset>
        ))
      )}
    </div>
  )
}
