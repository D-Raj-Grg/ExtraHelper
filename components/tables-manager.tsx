"use client"

import { useActionState, useState, useTransition } from "react"
import {
  createFloor,
  createTable,
  deleteTable,
  setTableState,
  type TablesState,
} from "@/app/(app)/tables/actions"
import { TABLE_STATES, type TableState } from "@/lib/table-constants"
import { TableQr } from "@/components/table-qr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Floor = { id: string; name: string }
type Table = {
  id: string
  label: string
  capacity: number
  state: string
  qr_token: string
  floor_id: string | null
}

const STATE_STYLES: Record<string, string> = {
  free: "bg-green-500/10 text-green-600 dark:text-green-400",
  occupied: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  reserved: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  bill_requested: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  cleaning: "bg-muted text-muted-foreground",
}

const inputClass =
  "border-input dark:bg-input/30 h-8 rounded-md border bg-transparent px-2 py-1 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"

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
}: {
  floors: Floor[]
  tables: Table[]
}) {
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

  const groups = [...floors, { id: "__none__", name: "Unassigned" }]

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
            <select name="floorId" className={inputClass} defaultValue="">
              <option value="">— floor —</option>
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" disabled={tablePending}>
              {tablePending ? "…" : "Add"}
            </Button>
          </div>
          <FormError state={tableState} />
        </form>
      </section>

      {/* Tables by floor ----------------------------------------------------- */}
      <section className="flex flex-col gap-6">
        {tables.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tables yet.</p>
        ) : (
          groups.map((floor) => {
            const list =
              floor.id === "__none__"
                ? tables.filter((t) => !t.floor_id)
                : tables.filter((t) => t.floor_id === floor.id)
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
                        <select
                          className={inputClass}
                          value={t.state}
                          disabled={pending}
                          onChange={(e) =>
                            startTransition(async () => {
                              await setTableState(t.id, e.target.value as TableState)
                            })
                          }
                        >
                          {TABLE_STATES.map((s) => (
                            <option key={s} value={s}>
                              {s.replace("_", " ")}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant={qrOpenId === t.id ? "default" : "outline"}
                          onClick={() => setQrOpenId(qrOpenId === t.id ? null : t.id)}
                          title="Show dine-in QR"
                        >
                          QR
                        </Button>
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
                    </div>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}
