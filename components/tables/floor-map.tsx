"use client"

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { tableStateLabel } from "@/lib/table-constants"
import { mapStateStyle } from "./state-badge"
import { TableActionsPanel } from "./table-actions-panel"
import { hasActiveOrder, type ActiveOrder, type Table } from "./types"

const NODE_W = 132

export function FloorMap({
  tables,
  orderByTable,
  positionFor,
  currency,
  pending,
  actionsOpenId,
  onToggleActions,
  onDragEnd,
  onTransfer,
  onMerge,
  onSplit,
}: {
  tables: Table[]
  orderByTable: Map<string, ActiveOrder>
  positionFor: (t: Table) => { x: number; y: number }
  currency: string
  pending: boolean
  actionsOpenId: string | null
  onToggleActions: (id: string | null) => void
  onDragEnd: (e: DragEndEvent) => void
  onTransfer: (fromId: string, toId: string) => void
  onMerge: (primaryId: string, otherId: string) => void
  onSplit: (fromId: string, toId: string | null, itemIds: string[]) => void
}) {
  // Keyboard sensor makes the map operable without a pointer: tab to a table,
  // space to pick up, arrows to move, space to drop.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  if (tables.length === 0)
    return (
      <div className="rounded-lg border border-dashed px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No tables on this floor yet. Add one above, then drag it into place.
        </p>
      </div>
    )

  return (
    <section>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="relative min-h-[420px] min-w-80 overflow-auto rounded-lg border bg-muted/10">
          {tables.map((t) => (
            <DraggableTable
              key={t.id}
              table={t}
              position={positionFor(t)}
              order={orderByTable.get(t.id)}
              others={tables.filter((o) => o.id !== t.id)}
              mergeTargets={tables.filter((o) => o.id !== t.id && hasActiveOrder(o, orderByTable))}
              showActions={hasActiveOrder(t, orderByTable)}
              isActionsOpen={actionsOpenId === t.id}
              onToggleActions={onToggleActions}
              currency={currency}
              pending={pending}
              onTransfer={onTransfer}
              onMerge={onMerge}
              onSplit={onSplit}
            />
          ))}
        </div>
      </DndContext>
      <p className="mt-2 text-xs text-muted-foreground">
        Drag a table by its header to reposition it, or focus it and use the arrow keys. Positions
        save automatically.
      </p>
    </section>
  )
}

function DraggableTable({
  table,
  position,
  order,
  others,
  mergeTargets,
  showActions,
  isActionsOpen,
  onToggleActions,
  currency,
  pending,
  onTransfer,
  onMerge,
  onSplit,
}: {
  table: Table
  position: { x: number; y: number }
  order: ActiveOrder | undefined
  others: Table[]
  mergeTargets: Table[]
  showActions: boolean
  isActionsOpen: boolean
  onToggleActions: (id: string | null) => void
  currency: string
  pending: boolean
  onTransfer: (fromId: string, toId: string) => void
  onMerge: (primaryId: string, otherId: string) => void
  onSplit: (fromId: string, toId: string | null, itemIds: string[]) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: table.id,
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: NODE_W,
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging || isActionsOpen ? 20 : 1,
      }}
      className={cn("rounded-lg border p-2 shadow-sm", mapStateStyle(table.state))}
    >
      <div
        {...listeners}
        {...attributes}
        aria-label={`${table.label}, ${tableStateLabel(table.state)}, seats ${table.capacity}. Press space to move.`}
        className={cn(
          "flex touch-none items-center justify-between rounded-sm",
          "cursor-grab active:cursor-grabbing",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
      >
        <span className="text-sm font-semibold">{table.label}</span>
        <span className="text-xs opacity-70">{tableStateLabel(table.state)}</span>
      </div>
      <p className="mt-0.5 text-xs opacity-70">Seats {table.capacity}</p>

      {showActions ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-1.5 h-7 w-full px-2 text-xs"
          aria-expanded={isActionsOpen}
          onClick={() => onToggleActions(isActionsOpen ? null : table.id)}
        >
          {isActionsOpen ? "Close" : "Actions"}
        </Button>
      ) : null}

      {isActionsOpen ? (
        <TableActionsPanel
          className="w-56"
          table={table}
          order={order}
          others={others}
          mergeTargets={mergeTargets}
          currency={currency}
          pending={pending}
          onTransfer={onTransfer}
          onMerge={onMerge}
          onSplit={onSplit}
        />
      ) : null}
    </div>
  )
}
