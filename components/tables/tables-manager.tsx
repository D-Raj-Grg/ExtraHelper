"use client"

import { useCallback, useEffect, useMemo, useOptimistic, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { DragEndEvent } from "@dnd-kit/core"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import {
  deleteTable,
  mergeTables,
  setTableState,
  splitTable,
  transferTable,
  updateTablePosition,
} from "@/app/(app)/tables/actions"
import type { TableState } from "@/lib/table-constants"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AddForms } from "./add-forms"
import { FloorMap } from "./floor-map"
import { TablesGrid } from "./tables-grid"
import { ALL_FLOORS, NO_FLOOR, type ActiveOrder, type Floor, type Table } from "./types"

export function TablesManager({
  floors,
  tables,
  activeOrders,
  currency,
  tenantId,
}: {
  floors: Floor[]
  tables: Table[]
  activeOrders: ActiveOrder[]
  currency: string
  tenantId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [qrOpenId, setQrOpenId] = useState<string | null>(null)
  const [actionsOpenId, setActionsOpenId] = useState<string | null>(null)
  const [view, setView] = useState<"grid" | "map">("grid")
  const [mapFloor, setMapFloor] = useState<string>(ALL_FLOORS)

  // Live base state, seeded from the server + kept fresh by Realtime (merge the
  // changed row in place — no refetch). Resync if the server data changes: the
  // reseed happens during render rather than in an effect, so a server refresh
  // never paints the stale list for a frame first.
  const [liveTables, setLiveTables] = useState<Table[]>(tables)
  const [seed, setSeed] = useState<Table[]>(tables)
  if (seed !== tables) {
    setSeed(tables)
    setLiveTables(tables)
  }

  // Optimistic floor-map positions so dragged nodes don't snap back before the
  // server round-trip / realtime echo lands. Keyed by table id.
  const [posOverride, setPosOverride] = useState<Record<string, { x: number; y: number }>>({})

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`tables:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "restaurant_tables",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload: RealtimePostgresChangesPayload<Table>) => {
          setLiveTables((prev) => {
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id?: string })?.id
              return prev.filter((t) => t.id !== oldId)
            }
            const row = payload.new as Table
            const idx = prev.findIndex((t) => t.id === row.id)
            if (idx === -1) return [...prev, row]
            return prev.map((t) => (t.id === row.id ? { ...t, ...row } : t))
          })
          // Server confirmed a position — drop the local override for that row.
          if (payload.eventType !== "DELETE") {
            const row = payload.new as Table
            setPosOverride((prev) => {
              if (!(row.id in prev)) return prev
              const next = { ...prev }
              delete next[row.id]
              return next
            })
          }
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [tenantId])

  // Optimistic table state — the select reflects the change instantly.
  const [optTables, setOptTable] = useOptimistic(
    liveTables,
    (state: Table[], patch: { id: string; state: string }) =>
      state.map((t) => (t.id === patch.id ? { ...t, state: patch.state } : t)),
  )

  const orderByTable = useMemo(() => {
    const m = new Map<string, ActiveOrder>()
    for (const o of activeOrders) if (o.table_id) m.set(o.table_id, o)
    return m
  }, [activeOrders])

  const positionFor = useCallback(
    (t: Table) => posOverride[t.id] ?? { x: t.pos_x ?? 0, y: t.pos_y ?? 0 },
    [posOverride],
  )

  // ---- Table actions ---------------------------------------------------------
  const runTransfer = useCallback(
    (fromId: string, toId: string) =>
      startTransition(async () => {
        const res = await transferTable(fromId, toId)
        if (res && "error" in res) toast.error(res.error)
        else {
          toast.success("Order transferred.")
          setActionsOpenId(null)
          router.refresh()
        }
      }),
    [router],
  )

  const runMerge = useCallback(
    (primaryId: string, otherId: string) =>
      startTransition(async () => {
        const res = await mergeTables(primaryId, otherId)
        if ("error" in res) toast.error(res.error)
        else {
          toast.success("Tables merged.")
          setActionsOpenId(null)
          router.push(`/bill/${res.billId}`)
        }
      }),
    [router],
  )

  const runSplit = useCallback(
    (fromId: string, toId: string | null, itemIds: string[]) =>
      startTransition(async () => {
        const res = await splitTable(fromId, toId, itemIds)
        if (res && "error" in res) toast.error(res.error)
        else {
          toast.success("Items split.")
          setActionsOpenId(null)
          router.refresh()
        }
      }),
    [router],
  )

  const runSetState = useCallback(
    (table: Table, next: TableState) =>
      startTransition(async () => {
        setOptTable({ id: table.id, state: next })
        const res = await setTableState(table.id, next)
        if (res && "error" in res) toast.error(res.error)
      }),
    [setOptTable],
  )

  const runDelete = useCallback(
    (table: Table) =>
      startTransition(async () => {
        // Was fire-and-forget: a failed delete (e.g. a table with history) left
        // the row on screen with no word as to why.
        const res = await deleteTable(table.id)
        if (res && "error" in res) toast.error(res.error)
        else toast.success(`${table.label} deleted.`)
      }),
    [],
  )

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const id = String(e.active.id)
      const table = optTables.find((t) => t.id === id)
      if (!table) return
      const start = positionFor(table)
      const nx = Math.max(0, Math.round(start.x + e.delta.x))
      const ny = Math.max(0, Math.round(start.y + e.delta.y))
      setPosOverride((prev) => ({ ...prev, [id]: { x: nx, y: ny } }))
      startTransition(async () => {
        const res = await updateTablePosition(id, nx, ny)
        if (res && "error" in res) toast.error(res.error)
      })
    },
    [optTables, positionFor],
  )

  const mapTables = optTables.filter((t) => {
    if (mapFloor === ALL_FLOORS) return true
    if (mapFloor === NO_FLOOR) return !t.floor_id
    return t.floor_id === mapFloor
  })

  return (
    <div className="flex flex-col gap-8">
      <AddForms floors={floors} />

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="View"
          className="inline-flex rounded-md border p-0.5"
        >
          <Button
            size="sm"
            variant={view === "grid" ? "default" : "ghost"}
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            Grid
          </Button>
          <Button
            size="sm"
            variant={view === "map" ? "default" : "ghost"}
            aria-pressed={view === "map"}
            onClick={() => setView("map")}
          >
            Floor map
          </Button>
        </div>

        {view === "map" && floors.length > 0 ? (
          <Select value={mapFloor} onValueChange={(v) => setMapFloor(String(v ?? ALL_FLOORS))}>
            <SelectTrigger className="w-44" aria-label="Filter map by floor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FLOORS}>All floors</SelectItem>
              {floors.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
              <SelectItem value={NO_FLOOR}>Unassigned</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {view === "map" ? (
        <FloorMap
          tables={mapTables}
          orderByTable={orderByTable}
          positionFor={positionFor}
          currency={currency}
          pending={pending}
          actionsOpenId={actionsOpenId}
          onToggleActions={setActionsOpenId}
          onDragEnd={onDragEnd}
          onTransfer={runTransfer}
          onMerge={runMerge}
          onSplit={runSplit}
        />
      ) : (
        <TablesGrid
          floors={floors}
          tables={optTables}
          orderByTable={orderByTable}
          currency={currency}
          pending={pending}
          qrOpenId={qrOpenId}
          actionsOpenId={actionsOpenId}
          onToggleQr={setQrOpenId}
          onToggleActions={setActionsOpenId}
          onSetState={runSetState}
          onDelete={runDelete}
          onTransfer={runTransfer}
          onMerge={runMerge}
          onSplit={runSplit}
        />
      )}
    </div>
  )
}
