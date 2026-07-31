"use client"

import { ArmchairIcon, UsersIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { tableStateLabel } from "@/lib/table-constants"
import { Card } from "@/components/ui/card"
import { TableGlyph } from "@/components/pos/table-glyph"
import type { PosFloor, PosOrderCard, PosTable } from "@/components/pos/types"

const NO_FLOOR = "__none__"

/**
 * One state, one hue, app-wide — same map the floor map, tables grid and
 * destination picker use. Colour is never the only signal: the state word sits
 * beside it and occupied swaps the armchair for a utensils icon, so the card
 * still reads under grayscale.
 */
const STATE_STYLE: Record<string, { dot: string; ring: string; glyph: string; text: string }> = {
  free: {
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/30",
    glyph: "text-emerald-600 dark:text-emerald-400",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  occupied: {
    dot: "bg-amber-500",
    ring: "ring-amber-500/40",
    glyph: "text-amber-600 dark:text-amber-400",
    text: "text-amber-700 dark:text-amber-400",
  },
  reserved: {
    dot: "bg-blue-500",
    ring: "ring-blue-500/30",
    glyph: "text-blue-600 dark:text-blue-400",
    text: "text-blue-700 dark:text-blue-400",
  },
  bill_requested: {
    dot: "bg-orange-500",
    ring: "ring-orange-500/40",
    glyph: "text-orange-600 dark:text-orange-400",
    text: "text-orange-700 dark:text-orange-400",
  },
  cleaning: {
    dot: "bg-muted-foreground/40",
    ring: "ring-border",
    glyph: "text-muted-foreground",
    text: "text-muted-foreground",
  },
}

function floorLabel(floors: PosFloor[], id: string): string {
  if (id === NO_FLOOR) return floors.length ? "Unassigned" : "Tables"
  return floors.find((f) => f.id === id)?.name ?? "Tables"
}

/**
 * A floor board. Tapping a table opens its live order (amend) if one is open,
 * or starts a new order seeded to that table. The parent decides which by
 * looking up an active order for the table id.
 */
export function TableTab({
  tables,
  floors,
  orders,
  onOpenOrder,
  onNewForTable,
}: {
  tables: PosTable[]
  floors: PosFloor[]
  orders: PosOrderCard[]
  onOpenOrder: (orderId: string) => void
  onNewForTable: (tableId: string) => void
}) {
  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
        <ArmchairIcon className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-base font-semibold">No tables yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Add tables under Table &amp; Space to seat guests. Orders can still go out as takeaway from
          the Orders tab.
        </p>
      </div>
    )
  }

  // The first active order per table — that's the one a tap should reopen.
  const orderByTable = new Map<string, PosOrderCard>()
  for (const o of orders) {
    if (o.table_id && !orderByTable.has(o.table_id)) orderByTable.set(o.table_id, o)
  }

  const groups = new Map<string, PosTable[]>()
  for (const t of tables) {
    const key = t.floor_id ?? NO_FLOOR
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }
  const ordered = [
    ...floors.filter((f) => groups.has(f.id)).map((f) => f.id),
    ...(groups.has(NO_FLOOR) ? [NO_FLOOR] : []),
  ]

  return (
    <div className="space-y-5">
      {ordered.map((floorId) => (
        <section key={floorId}>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            {floorLabel(floors, floorId)}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {(groups.get(floorId) ?? []).map((t) => {
              const order = orderByTable.get(t.id)
              const occupied = Boolean(order) || t.state === "occupied"
              const style = STATE_STYLE[t.state] ?? STATE_STYLE.cleaning
              const stateWord = order ? "Occupied" : tableStateLabel(t.state)
              return (
                <Card
                  key={t.id}
                  className={cn(
                    "p-0 ring-1 transition-[box-shadow,transform] duration-150 ease-out",
                    "has-[:hover]:ring-ring/50 has-[:active]:scale-[0.99] motion-reduce:transition-none motion-reduce:has-[:active]:scale-100",
                    style.ring,
                  )}
                >
                  <button
                    type="button"
                    onClick={() =>
                      order ? onOpenOrder(order.id) : onNewForTable(t.id)
                    }
                    aria-label={
                      order
                        ? `Open order for table ${t.label} — occupied`
                        : `Start an order for table ${t.label} — ${stateWord.toLowerCase()}`
                    }
                    className="flex min-h-28 w-full items-start gap-3 rounded-xl p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <TableGlyph
                      seats={t.capacity ?? 2}
                      filled={occupied}
                      className={cn("size-11 shrink-0", style.glyph)}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="truncate text-lg font-bold leading-tight">
                        Table {t.label}
                      </span>
                      <span
                        className={cn("flex items-center gap-1.5 text-sm font-medium", style.text)}
                      >
                        <span
                          className={cn("size-2 shrink-0 rounded-full", style.dot)}
                          aria-hidden
                        />
                        {stateWord}
                      </span>
                      {t.capacity ? (
                        <span className="mt-auto flex items-center gap-1 text-xs text-muted-foreground">
                          <UsersIcon className="size-3.5 shrink-0" aria-hidden />
                          <span className="tabular-nums">{t.capacity}</span>
                          <span>seats</span>
                        </span>
                      ) : null}
                    </span>
                  </button>
                </Card>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
