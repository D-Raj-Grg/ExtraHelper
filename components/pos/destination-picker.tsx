"use client"

import { cn } from "@/lib/utils"
import { tableStateLabel } from "@/lib/table-constants"
import type { CachedTable } from "@/lib/offline/menu-cache"

/** Same hues the floor map and tables grid use — one state, one colour, app-wide. */
const STATE_DOT: Record<string, string> = {
  free: "bg-emerald-500",
  occupied: "bg-amber-500",
  reserved: "bg-blue-500",
  bill_requested: "bg-orange-500",
  cleaning: "bg-muted-foreground/40",
}

export const TAKEAWAY = ""

/**
 * Where the order is going. Native radios under the chips: one tap instead of
 * open-scan-tap, and arrow-key navigation plus screen-reader semantics come for
 * free — which a div-with-onClick chip row would have thrown away.
 */
export function DestinationPicker({
  tables,
  value,
  onChange,
}: {
  tables: CachedTable[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold">Send to</legend>
      <div className="flex flex-wrap gap-2">
        <Chip
          checked={value === TAKEAWAY}
          onChange={() => onChange(TAKEAWAY)}
          name="Takeaway"
          detail="Pickup"
        />
        {tables.map((t) => (
          <Chip
            key={t.id}
            checked={value === t.id}
            onChange={() => onChange(t.id)}
            name={`Table ${t.label}`}
            detail={tableStateLabel(t.state)}
            dot={STATE_DOT[t.state] ?? STATE_DOT.cleaning}
          />
        ))}
      </div>
    </fieldset>
  )
}

function Chip({
  checked,
  onChange,
  name,
  detail,
  dot,
}: {
  checked: boolean
  onChange: () => void
  name: string
  detail: string
  dot?: string
}) {
  return (
    <label
      className={cn(
        "relative flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border-2 px-3 py-1.5",
        "transition-colors motion-reduce:transition-none",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card hover:border-ring/50",
      )}
    >
      <input
        type="radio"
        name="pos-destination"
        className="sr-only"
        checked={checked}
        onChange={onChange}
      />
      {dot ? (
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            // A solid state dot vanishes against the selected fill.
            checked ? "bg-primary-foreground" : dot,
          )}
        />
      ) : null}
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold">{name}</span>
        <span className={cn("text-xs", checked ? "opacity-80" : "text-muted-foreground")}>
          {detail}
        </span>
      </span>
    </label>
  )
}
