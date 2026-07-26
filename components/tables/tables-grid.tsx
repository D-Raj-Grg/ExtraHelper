"use client"

import { useState } from "react"
import { QrCodeIcon, Trash2Icon } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TABLE_STATES, tableStateLabel, type TableState } from "@/lib/table-constants"
import { TableQr } from "@/components/table-qr"
import { StateBadge } from "./state-badge"
import { TableActionsPanel } from "./table-actions-panel"
import { hasActiveOrder, NO_FLOOR, type ActiveOrder, type Floor, type Table } from "./types"

export function TablesGrid({
  floors,
  tables,
  orderByTable,
  currency,
  pending,
  qrOpenId,
  actionsOpenId,
  onToggleQr,
  onToggleActions,
  onSetState,
  onDelete,
  onTransfer,
  onMerge,
  onSplit,
}: {
  floors: Floor[]
  tables: Table[]
  orderByTable: Map<string, ActiveOrder>
  currency: string
  pending: boolean
  qrOpenId: string | null
  actionsOpenId: string | null
  onToggleQr: (id: string | null) => void
  onToggleActions: (id: string | null) => void
  onSetState: (table: Table, next: TableState) => void
  onDelete: (table: Table) => void
  onTransfer: (fromId: string, toId: string) => void
  onMerge: (primaryId: string, otherId: string) => void
  onSplit: (fromId: string, toId: string | null, itemIds: string[]) => void
}) {
  // Checked against the live list, not the server prop — a table deleted by a
  // colleague must still flip this to the empty state.
  if (tables.length === 0)
    return (
      <div className="rounded-lg border border-dashed px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No tables yet. Add your first one above to start seating guests.
        </p>
      </div>
    )

  const groups: Floor[] = [...floors, { id: NO_FLOOR, name: "Unassigned" }]

  return (
    <section className="flex flex-col gap-6">
      {groups.map((floor) => {
        const list =
          floor.id === NO_FLOOR
            ? tables.filter((t) => !t.floor_id)
            : tables.filter((t) => t.floor_id === floor.id)
        if (list.length === 0) return null

        return (
          <div key={floor.id}>
            <h3 className="mb-2 font-medium">{floor.name}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((t) => (
                <Card key={t.id} size="sm">
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold">{t.label}</span>
                      <StateBadge state={t.state} />
                    </div>
                    <p className="-mt-2 text-xs text-muted-foreground">Seats {t.capacity}</p>

                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={t.state}
                        onValueChange={(v) => onSetState(t, String(v) as TableState)}
                      >
                        <SelectTrigger className="w-full" aria-label={`State of ${t.label}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TABLE_STATES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {tableStateLabel(s)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Button
                        size="sm"
                        variant={qrOpenId === t.id ? "default" : "outline"}
                        aria-expanded={qrOpenId === t.id}
                        onClick={() => onToggleQr(qrOpenId === t.id ? null : t.id)}
                      >
                        <QrCodeIcon className="size-4" />
                        QR
                        <span className="sr-only">{` for ${t.label}`}</span>
                      </Button>

                      {hasActiveOrder(t, orderByTable) ? (
                        <Button
                          size="sm"
                          variant={actionsOpenId === t.id ? "default" : "outline"}
                          aria-expanded={actionsOpenId === t.id}
                          onClick={() => onToggleActions(actionsOpenId === t.id ? null : t.id)}
                        >
                          Actions
                          <span className="sr-only">{` for ${t.label}`}</span>
                        </Button>
                      ) : null}

                      <DeleteTableButton table={t} pending={pending} onDelete={onDelete} />
                    </div>

                    {qrOpenId === t.id ? <TableQr token={t.qr_token} label={t.label} /> : null}
                    {actionsOpenId === t.id ? (
                      <TableActionsPanel
                        table={t}
                        order={orderByTable.get(t.id)}
                        others={tables.filter((o) => o.id !== t.id)}
                        mergeTargets={tables.filter(
                          (o) => o.id !== t.id && hasActiveOrder(o, orderByTable),
                        )}
                        currency={currency}
                        pending={pending}
                        onTransfer={onTransfer}
                        onMerge={onMerge}
                        onSplit={onSplit}
                      />
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}

/**
 * Deleting a table is irreversible and the button sits beside everyday
 * controls, so it asks first — and says what's at stake when the table is
 * mid-service.
 */
function DeleteTableButton({
  table,
  pending,
  onDelete,
}: {
  table: Table
  pending: boolean
  onDelete: (table: Table) => void
}) {
  // Controlled: AlertDialogAction is a plain Button here, so confirming has to
  // close the dialog itself.
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button size="icon-sm" variant="ghost" disabled={pending}>
            <Trash2Icon className="size-4" />
            <span className="sr-only">Delete {table.label}</span>
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {table.label}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the table and its dine-in QR code for good. Any printed QR for{" "}
            {table.label} will stop working.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setOpen(false)
              onDelete(table)
            }}
          >
            Delete table
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
