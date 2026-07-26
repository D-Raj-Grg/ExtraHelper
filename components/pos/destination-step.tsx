"use client"

import { ShoppingBagIcon } from "lucide-react"

import { tableStateLabel } from "@/lib/table-constants"
import { ChoiceChip } from "@/components/pos/choice-chip"
import { TAKEAWAY, type PosFloor, type PosTable } from "@/components/pos/types"

/** One state, one hue, app-wide — same map the floor map and tables grid use. */
const STATE_DOT: Record<string, string> = {
  free: "bg-emerald-500",
  occupied: "bg-amber-500",
  reserved: "bg-blue-500",
  bill_requested: "bg-orange-500",
  cleaning: "bg-muted-foreground/40",
}

const NO_FLOOR = "__none__"

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
        <legend className="mb-2 text-sm font-semibold">Takeaway</legend>
        <ChoiceChip
          name="pos-destination"
          checked={value === TAKEAWAY}
          onSelect={() => onChange(TAKEAWAY)}
          label={
            <span className="flex items-center gap-1.5">
              <ShoppingBagIcon className="size-4 shrink-0" aria-hidden />
              Takeaway
            </span>
          }
          detail="No table"
          className="w-full sm:w-56"
        />
      </fieldset>

      {tables.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tables yet — this order can still go out as takeaway. Add tables under Table &amp; Space
          to seat guests.
        </p>
      ) : (
        ordered.map((floorId) => (
          <fieldset key={floorId}>
            <legend className="mb-2 text-sm font-semibold">{floorLabel(floors, floorId)}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {(groups.get(floorId) ?? []).map((t) => (
                <ChoiceChip
                  key={t.id}
                  name="pos-destination"
                  checked={value === t.id}
                  onSelect={() => onChange(t.id)}
                  label={`Table ${t.label}`}
                  // The dot is never the only signal — the state is spelled out
                  // next to it, and seats give the host the other half.
                  detail={
                    t.capacity
                      ? `${tableStateLabel(t.state)} · ${t.capacity} seats`
                      : tableStateLabel(t.state)
                  }
                  dot={STATE_DOT[t.state] ?? STATE_DOT.cleaning}
                />
              ))}
            </div>
          </fieldset>
        ))
      )}
    </div>
  )
}
