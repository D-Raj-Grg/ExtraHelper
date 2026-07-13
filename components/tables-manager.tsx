"use client"

import { useActionState, useEffect, useMemo, useOptimistic, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import {
  createFloor,
  createTable,
  deleteTable,
  mergeTables,
  setTableState,
  splitTable,
  transferTable,
  updateTablePosition,
  type TablesState,
} from "@/app/(app)/tables/actions"
import { TABLE_STATES, type TableState } from "@/lib/table-constants"
import { money } from "@/lib/format"
import { TableQr } from "@/components/table-qr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Floor = { id: string; name: string }
type Table = {
  id: string
  label: string
  capacity: number
  state: string
  qr_token: string
  floor_id: string | null
  pos_x: number | null
  pos_y: number | null
  shape: string | null
  current_order_id: string | null
}
type OrderItem = {
  id: string
  name_snapshot: string
  qty: number
  unit_price_cents: number
  is_void: boolean
}
type ActiveOrder = {
  id: string
  table_id: string | null
  status: string
  order_items: OrderItem[]
}

// Badge/pill colouring (grid view).
const STATE_STYLES: Record<string, string> = {
  free: "bg-green-500/10 text-green-600 dark:text-green-400",
  occupied: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  reserved: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  bill_requested: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  cleaning: "bg-muted text-muted-foreground",
}

// Solid-ish node colouring (floor map).
const MAP_STATE_STYLES: Record<string, string> = {
  free: "bg-muted text-foreground border-border",
  occupied: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
  reserved: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40",
  bill_requested: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/40",
  cleaning: "bg-muted text-muted-foreground border-border",
}

const NODE_W = 132

function hasActiveOrder(t: Table, orderByTable: Map<string, ActiveOrder>): boolean {
  return orderByTable.has(t.id) || t.state === "occupied" || t.state === "bill_requested"
}

function FormError({ state }: { state: TablesState }) {
  if (state && "error" in state)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    )
  return null
}

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
  const [floorState, floorAction, floorPending] = useActionState<TablesState, FormData>(
    createFloor,
    undefined,
  )
  const [tableState, tableAction, tablePending] = useActionState<TablesState, FormData>(
    createTable,
    undefined,
  )
  const [pending, startTransition] = useTransition()
  const [qrOpenId, setQrOpenId] = useState<string | null>(null)
  const [actionsOpenId, setActionsOpenId] = useState<string | null>(null)
  const [view, setView] = useState<"grid" | "map">("grid")
  const [mapFloor, setMapFloor] = useState<string>("__all__")

  // Live base state, seeded from the server + kept fresh by Realtime (merge the
  // changed row in place — no refetch). Resync if the server data changes.
  const [liveTables, setLiveTables] = useState<Table[]>(tables)
  useEffect(() => setLiveTables(tables), [tables])

  // Optimistic floor-map positions so dragged nodes don't snap back before the
  // server round-trip / realtime echo lands. Keyed by table id.
  const [posOverride, setPosOverride] = useState<Record<string, { x: number; y: number }>>({})

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`tables:${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "restaurant_tables", filter: `tenant_id=eq.${tenantId}` },
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

  // Optimistic table state — the <select> reflects the change instantly.
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

  const groups = [...floors, { id: "__none__", name: "Unassigned" }]

  function posFor(t: Table): { x: number; y: number } {
    return posOverride[t.id] ?? { x: t.pos_x ?? 0, y: t.pos_y ?? 0 }
  }

  // ---- Table actions ---------------------------------------------------------
  function runTransfer(fromId: string, toId: string) {
    startTransition(async () => {
      const res = await transferTable(fromId, toId)
      if (res && "error" in res) toast.error(res.error)
      else {
        toast.success("Order transferred.")
        setActionsOpenId(null)
        router.refresh()
      }
    })
  }

  function runMerge(primaryId: string, otherId: string) {
    startTransition(async () => {
      const res = await mergeTables(primaryId, otherId)
      if ("error" in res) toast.error(res.error)
      else {
        toast.success("Tables merged.")
        setActionsOpenId(null)
        router.push(`/bill/${res.billId}`)
      }
    })
  }

  function runSplit(fromId: string, toId: string | null, itemIds: string[]) {
    startTransition(async () => {
      const res = await splitTable(fromId, toId, itemIds)
      if (res && "error" in res) toast.error(res.error)
      else {
        toast.success("Items split.")
        setActionsOpenId(null)
        router.refresh()
      }
    })
  }

  function TableActionsPanel({ table }: { table: Table }) {
    const order = orderByTable.get(table.id)
    const items = (order?.order_items ?? []).filter((i) => !i.is_void)
    const others = optTables.filter((t) => t.id !== table.id)
    const mergeTargets = others.filter((t) => hasActiveOrder(t, orderByTable))

    const [transferTo, setTransferTo] = useState("")
    const [mergeWith, setMergeWith] = useState("")
    const [splitTo, setSplitTo] = useState("__new__")
    const [checked, setChecked] = useState<Record<string, boolean>>({})

    const selectedItemIds = items.filter((i) => checked[i.id]).map((i) => i.id)

    return (
      <div className="mt-3 flex flex-col gap-4 rounded-md border bg-muted/30 p-3 text-xs">
        {/* Transfer ------------------------------------------------------- */}
        <div className="flex flex-col gap-1.5">
          <span className="font-medium">Transfer order to</span>
          <div className="flex gap-2">
            <Select value={transferTo} onValueChange={(v) => setTransferTo(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="— table —" />
              </SelectTrigger>
              <SelectContent>
                {others.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || !transferTo}
              onClick={() => transferTo && runTransfer(table.id, transferTo)}
            >
              Transfer
            </Button>
          </div>
        </div>

        {/* Merge ---------------------------------------------------------- */}
        <div className="flex flex-col gap-1.5">
          <span className="font-medium">Merge with</span>
          {mergeTargets.length === 0 ? (
            <p className="text-muted-foreground">No other table has an active order.</p>
          ) : (
            <div className="flex gap-2">
              <Select value={mergeWith} onValueChange={(v) => setMergeWith(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="— table —" />
                </SelectTrigger>
                <SelectContent>
                  {mergeTargets.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || !mergeWith}
                onClick={() => mergeWith && runMerge(table.id, mergeWith)}
              >
                Merge
              </Button>
            </div>
          )}
        </div>

        {/* Split ---------------------------------------------------------- */}
        <div className="flex flex-col gap-1.5">
          <span className="font-medium">Split items</span>
          {items.length === 0 ? (
            <p className="text-muted-foreground">No items on this order to split.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1">
                {items.map((i) => (
                  <li key={i.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`split-${table.id}-${i.id}`}
                      checked={!!checked[i.id]}
                      onCheckedChange={(c: boolean) =>
                        setChecked((prev) => ({ ...prev, [i.id]: c }))
                      }
                    />
                    <label
                      htmlFor={`split-${table.id}-${i.id}`}
                      className="flex flex-1 cursor-pointer justify-between gap-2"
                    >
                      <span>
                        {i.qty}× {i.name_snapshot}
                      </span>
                      <span className="text-muted-foreground">{money(i.unit_price_cents * i.qty, currency)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Select value={splitTo} onValueChange={(v) => setSplitTo(v ?? "__new__")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__new__">New takeaway order</SelectItem>
                    {others.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending || selectedItemIds.length === 0}
                  onClick={() =>
                    runSplit(table.id, splitTo === "__new__" ? null : splitTo, selectedItemIds)
                  }
                >
                  Split
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ---- Floor map node --------------------------------------------------------
  function DraggableTable({ table }: { table: Table }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: table.id })
    const { x, y } = posFor(table)
    const showActions = hasActiveOrder(table, orderByTable)
    return (
      <div
        ref={setNodeRef}
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: NODE_W,
          transform: CSS.Translate.toString(transform),
          zIndex: isDragging || actionsOpenId === table.id ? 20 : 1,
        }}
        className={`rounded-lg border p-2 shadow-sm ${MAP_STATE_STYLES[table.state] ?? MAP_STATE_STYLES.cleaning}`}
      >
        <div
          {...listeners}
          {...attributes}
          className="flex cursor-grab touch-none items-center justify-between active:cursor-grabbing"
        >
          <span className="text-sm font-semibold">{table.label}</span>
          <span className="text-[10px] opacity-70">{table.state.replace("_", " ")}</span>
        </div>
        <p className="mt-0.5 text-[10px] opacity-70">Seats {table.capacity}</p>
        {showActions ? (
          <Button
            size="sm"
            variant="outline"
            className="mt-1 h-6 w-full px-2 text-[10px]"
            onClick={() => setActionsOpenId(actionsOpenId === table.id ? null : table.id)}
          >
            {actionsOpenId === table.id ? "Close" : "Actions"}
          </Button>
        ) : null}
        {actionsOpenId === table.id ? (
          <div className="w-56">
            <TableActionsPanel table={table} />
          </div>
        ) : null}
      </div>
    )
  }

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id)
    const table = optTables.find((t) => t.id === id)
    if (!table) return
    const start = posFor(table)
    const nx = Math.max(0, Math.round(start.x + e.delta.x))
    const ny = Math.max(0, Math.round(start.y + e.delta.y))
    setPosOverride((prev) => ({ ...prev, [id]: { x: nx, y: ny } }))
    startTransition(async () => {
      const res = await updateTablePosition(id, nx, ny)
      if (res && "error" in res) toast.error(res.error)
    })
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const mapTables = optTables.filter((t) => {
    if (mapFloor === "__all__") return true
    if (mapFloor === "__none__") return !t.floor_id
    return t.floor_id === mapFloor
  })

  return (
    <div className="flex flex-col gap-8">
      {/* Add floor / table --------------------------------------------------- */}
      <section className="grid gap-4 sm:grid-cols-2">
        <form action={floorAction} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Add floor</h2>
          <div className="flex gap-2">
            <Input name="name" placeholder="e.g. Ground Floor" required />
            <Button type="submit" size="sm" variant="secondary" disabled={floorPending}>
              {floorPending ? "…" : "Add"}
            </Button>
          </div>
          <FormError state={floorState} />
        </form>

        <form action={tableAction} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Add table</h2>
          <div className="flex flex-wrap gap-2">
            <Input name="label" placeholder="T1" className="w-20" required />
            <Input
              name="capacity"
              type="number"
              min={1}
              defaultValue={4}
              className="w-20"
              required
            />
            <Select name="floorId" defaultValue="">
              <SelectTrigger className="w-full">
                <SelectValue placeholder="— floor —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— floor —</SelectItem>
                {floors.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" disabled={tablePending}>
              {tablePending ? "…" : "Add"}
            </Button>
          </div>
          <FormError state={tableState} />
        </form>
      </section>

      {/* View toggle --------------------------------------------------------- */}
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-md border p-0.5">
          <Button
            size="sm"
            variant={view === "grid" ? "default" : "ghost"}
            onClick={() => setView("grid")}
          >
            Grid
          </Button>
          <Button
            size="sm"
            variant={view === "map" ? "default" : "ghost"}
            onClick={() => setView("map")}
          >
            Floor map
          </Button>
        </div>
        {view === "map" && floors.length > 0 ? (
          <Select value={mapFloor} onValueChange={(v) => setMapFloor(v ?? "__all__")}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All floors</SelectItem>
              {floors.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
              <SelectItem value="__none__">Unassigned</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {/* Floor map ----------------------------------------------------------- */}
      {view === "map" ? (
        <section>
          {mapTables.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tables to arrange.</p>
          ) : (
            <DndContext sensors={sensors} onDragEnd={onDragEnd}>
              <div
                className="relative min-h-[420px] overflow-auto rounded-lg border bg-muted/10"
                style={{ minWidth: 320 }}
              >
                {mapTables.map((t) => (
                  <DraggableTable key={t.id} table={t} />
                ))}
              </div>
            </DndContext>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Drag a table by its header to reposition it. Positions save automatically.
          </p>
        </section>
      ) : null}

      {/* Tables by floor (grid) ---------------------------------------------- */}
      {view === "grid" ? (
        <section className="flex flex-col gap-6">
          {tables.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tables yet.</p>
          ) : (
            groups.map((floor) => {
              const list =
                floor.id === "__none__"
                  ? optTables.filter((t) => !t.floor_id)
                  : optTables.filter((t) => t.floor_id === floor.id)
              if (list.length === 0) return null
              return (
                <div key={floor.id}>
                  <h3 className="mb-2 font-medium">{floor.name}</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((t) => (
                      <div key={t.id} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{t.label}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              STATE_STYLES[t.state] ?? STATE_STYLES.cleaning
                            }`}
                          >
                            {t.state.replace("_", " ")}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Seats {t.capacity}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Select
                            value={t.state}
                            disabled={pending}
                            onValueChange={(v) => {
                              const next = v as TableState
                              startTransition(async () => {
                                setOptTable({ id: t.id, state: next })
                                const res = await setTableState(t.id, next)
                                if (res && "error" in res) toast.error(res.error)
                              })
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TABLE_STATES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s.replace("_", " ")}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant={qrOpenId === t.id ? "default" : "outline"}
                            onClick={() => setQrOpenId(qrOpenId === t.id ? null : t.id)}
                            title="Show dine-in QR"
                          >
                            QR
                          </Button>
                          {hasActiveOrder(t, orderByTable) ? (
                            <Button
                              size="sm"
                              variant={actionsOpenId === t.id ? "default" : "outline"}
                              onClick={() =>
                                setActionsOpenId(actionsOpenId === t.id ? null : t.id)
                              }
                            >
                              Actions
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={pending}
                            onClick={() =>
                              startTransition(async () => {
                                await deleteTable(t.id)
                              })
                            }
                          >
                            Delete
                          </Button>
                        </div>
                        {qrOpenId === t.id ? (
                          <TableQr token={t.qr_token} label={t.label} />
                        ) : null}
                        {actionsOpenId === t.id ? <TableActionsPanel table={t} /> : null}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </section>
      ) : null}
    </div>
  )
}
