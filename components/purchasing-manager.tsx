"use client"

import { useActionState, useTransition } from "react"
import {
  addPOItem,
  createPO,
  createSupplier,
  receivePO,
  type PurchState,
} from "@/app/(app)/purchasing/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"

type Supplier = { id: string; name: string; phone: string | null }
type ItemOpt = { id: string; name: string; uom: string }
type POLine = {
  id: string
  qty_ordered: number
  qty_received: number
  unit_cost_cents: number
  inventory_items: { name: string; uom: string } | null
}
type PO = {
  id: string
  status: string
  created_at: string
  suppliers: { name: string } | null
  po_items: POLine[]
}

const inputClass =
  "border-input dark:bg-input/30 h-8 rounded-md border bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  partial: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  received: "bg-green-500/10 text-green-600 dark:text-green-400",
  cancelled: "bg-red-500/10 text-red-600 dark:text-red-400",
}

function FormError({ state }: { state: PurchState }) {
  if (state && "error" in state)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    )
  return null
}

export function PurchasingManager({
  currency,
  suppliers,
  items,
  purchaseOrders,
}: {
  currency: string
  suppliers: Supplier[]
  items: ItemOpt[]
  purchaseOrders: PO[]
}) {
  const [supState, supAction, supPending] = useActionState<PurchState, FormData>(
    createSupplier,
    undefined,
  )
  const [poState, poAction, poPending] = useActionState<PurchState, FormData>(
    createPO,
    undefined,
  )
  const [lineState, lineAction, linePending] = useActionState<PurchState, FormData>(
    addPOItem,
    undefined,
  )
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex flex-col gap-8">
      {/* Suppliers */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Suppliers</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {suppliers.length === 0 ? (
            <span className="text-sm text-muted-foreground">No suppliers yet.</span>
          ) : (
            suppliers.map((s) => (
              <span key={s.id} className="rounded-full bg-muted px-3 py-1 text-sm">
                {s.name}
                {s.phone ? ` · ${s.phone}` : ""}
              </span>
            ))
          )}
        </div>
        <form action={supAction} className="flex flex-wrap items-center gap-2">
          <Input name="name" placeholder="Supplier name" className="max-w-48" required />
          <Input name="phone" placeholder="Phone" className="max-w-32" />
          <Button type="submit" size="sm" variant="secondary" disabled={supPending}>
            {supPending ? "…" : "Add supplier"}
          </Button>
          <FormError state={supState} />
        </form>
      </section>

      {/* Create PO */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">New purchase order</h2>
        <form action={poAction} className="flex flex-wrap items-center gap-2">
          <Select name="supplierId" defaultValue="">
            <SelectTrigger className="w-full">
              <SelectValue placeholder="— supplier —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">— supplier —</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" disabled={poPending}>
            {poPending ? "…" : "Create PO"}
          </Button>
          <FormError state={poState} />
        </form>
      </section>

      {/* PO list */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Purchase orders</h2>
        {purchaseOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No purchase orders yet.</p>
        ) : (
          purchaseOrders.map((po) => {
            const received = po.status === "received"
            return (
              <div key={po.id} className="rounded-lg border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium">{po.suppliers?.name ?? "No supplier"}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[po.status] ?? STATUS_STYLES.draft
                    }`}
                  >
                    {po.status}
                  </span>
                </div>
                {po.po_items.length > 0 ? (
                  <Table className="mb-2 w-full text-sm">
                    <TableBody>
                      {po.po_items.map((l) => (
                        <TableRow key={l.id} className="border-t">
                          <TableCell className="py-1">{l.inventory_items?.name}</TableCell>
                          <TableCell className="py-1 text-muted-foreground">
                            {Number(l.qty_received)}/{Number(l.qty_ordered)} {l.inventory_items?.uom}
                          </TableCell>
                          <TableCell className="py-1 text-right text-muted-foreground">
                            {money(l.unit_cost_cents, currency)}/{l.inventory_items?.uom}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="mb-2 text-xs text-muted-foreground">No lines yet.</p>
                )}

                {!received ? (
                  <div className="flex flex-col gap-2">
                    <form action={lineAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="poId" value={po.id} />
                      <Select name="inventoryItemId" defaultValue="" required>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="— item —" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">— item —</SelectItem>
                          {items.map((i) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input name="qty" type="number" step="0.001" placeholder="qty" className="h-8 w-20 text-xs" required />
                      <Input name="cost" type="number" step="0.01" placeholder="unit cost" className="h-8 w-24 text-xs" />
                      <Button type="submit" size="sm" variant="secondary" disabled={linePending}>
                        Add line
                      </Button>
                    </form>
                    <div>
                      <Button
                        size="sm"
                        disabled={pending || po.po_items.length === 0}
                        onClick={() => startTransition(async () => { await receivePO(po.id) })}
                      >
                        Receive (GRN)
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-green-600 dark:text-green-400">Received · stock updated</p>
                )}
              </div>
            )
          })
        )}
        <FormError state={lineState} />
      </section>
    </div>
  )
}
