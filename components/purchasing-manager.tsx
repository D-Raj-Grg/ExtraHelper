"use client"

import { useActionState, useState, useTransition } from "react"
import {
  CheckCircle2Icon,
  FileTextIcon,
  PlusIcon,
  SendIcon,
  TruckIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react"

import {
  addPOItem,
  createPO,
  createSupplier,
  receivePO,
  receivePOPartial,
  type PurchState,
} from "@/app/(app)/purchasing/actions"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { PaymentDialog } from "@/components/purchasing/payment-dialog"
import { Payables, type SupplierBalance } from "@/components/purchasing/payables"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
  supplier_id: string | null
  suppliers: { name: string } | null
  po_items: POLine[]
}

/** Received value of a PO — what you owe for what actually arrived. */
function receivedCents(po: PO) {
  return po.po_items.reduce(
    (sum, l) => sum + Number(l.qty_received) * Number(l.unit_cost_cents),
    0,
  )
}

/** Status carries an icon + label + semantic colour — never colour alone. */
const STATUS: Record<string, { label: string; className: string; icon: LucideIcon }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground", icon: FileTextIcon },
  sent: { label: "Sent", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400", icon: SendIcon },
  partial: { label: "Partial", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400", icon: TruckIcon },
  received: { label: "Received", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", icon: CheckCircle2Icon },
  cancelled: { label: "Cancelled", className: "bg-destructive/10 text-destructive", icon: XCircleIcon },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.draft
  const Icon = s.icon
  return (
    <Badge className={cn("gap-1", s.className)}>
      <Icon className="size-3.5" />
      {s.label}
    </Badge>
  )
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

function outstanding(l: POLine) {
  return Math.max(0, Number(l.qty_ordered) - Number(l.qty_received))
}

function POCard({
  po,
  currency,
  items,
  suppliers,
  paidCents,
  lineAction,
  linePending,
}: {
  po: PO
  currency: string
  items: ItemOpt[]
  suppliers: Supplier[]
  /** Already paid against this PO, from supplier_payments. */
  paidCents: number
  lineAction: (payload: FormData) => void
  linePending: boolean
}) {
  const [pending, startTransition] = useTransition()
  const closed = po.status === "received" || po.status === "cancelled"
  const received = receivedCents(po)
  const outstandingValue = received - paidCents

  // Per-line entered receive qty, keyed by po_item_id; default to outstanding.
  const [entered, setEntered] = useState<Record<string, string>>(() =>
    Object.fromEntries(po.po_items.map((l) => [l.id, String(outstanding(l))])),
  )

  function receiveEntered() {
    const lines = po.po_items
      .map((l) => ({ po_item_id: l.id, qty: Number(entered[l.id] ?? "") }))
      .filter((l) => Number.isFinite(l.qty) && l.qty > 0)
    if (!lines.length) return
    startTransition(async () => {
      await receivePOPartial(po.id, lines)
    })
  }

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{po.suppliers?.name ?? "No supplier"}</span>
        <StatusBadge status={po.status} />
      </div>

      {received > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="tabular-nums">Received {money(received, currency)}</span>
          <span className="tabular-nums">Paid {money(paidCents, currency)}</span>
          {outstandingValue > 0 ? (
            <span className="tabular-nums text-amber-700 dark:text-amber-400">
              {money(outstandingValue, currency)} owing
            </span>
          ) : (
            <span className="tabular-nums text-emerald-700 dark:text-emerald-400">Settled</span>
          )}
          {po.supplier_id ? (
            <PaymentDialog
              currency={currency}
              suppliers={suppliers}
              poId={po.id}
              supplierId={po.supplier_id}
              triggerLabel="Record payment"
              outstandingCents={outstandingValue}
            />
          ) : null}
        </div>
      ) : null}

      {po.po_items.length > 0 ? (
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Received</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              {!closed ? <TableHead className="w-24 text-right">Receive</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {po.po_items.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="py-1">{l.inventory_items?.name}</TableCell>
                <TableCell className="py-1 text-muted-foreground tabular-nums">
                  {Number(l.qty_received)}/{Number(l.qty_ordered)} {l.inventory_items?.uom}
                </TableCell>
                <TableCell className="py-1 text-right text-muted-foreground tabular-nums">
                  {money(l.unit_cost_cents, currency)}/{l.inventory_items?.uom}
                </TableCell>
                {!closed ? (
                  <TableCell className="py-1 text-right">
                    <Input
                      type="number"
                      step="0.001"
                      min={0}
                      value={entered[l.id] ?? ""}
                      onChange={(e) => setEntered((prev) => ({ ...prev, [l.id]: e.target.value }))}
                      aria-label={`Quantity to receive for ${l.inventory_items?.name ?? "item"}`}
                      className="ml-auto h-9 w-20 text-right tabular-nums"
                      disabled={outstanding(l) === 0}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-xs text-muted-foreground">No lines yet.</p>
      )}

      {!closed ? (
        <div className="flex flex-col gap-2">
          <form action={lineAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="poId" value={po.id} />
            <Select name="inventoryItemId" required>
              <SelectTrigger className="w-full" aria-label="Item to add">
                <SelectValue placeholder="Select item" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              name="qty"
              type="number"
              step="0.001"
              placeholder="Qty"
              aria-label="Quantity ordered"
              className="h-9 w-20 text-right tabular-nums"
              required
            />
            <Input
              name="cost"
              type="number"
              step="0.01"
              placeholder="Unit cost"
              aria-label="Unit cost"
              className="h-9 w-24 text-right tabular-nums"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={linePending}>
              <PlusIcon className="size-4" /> Add line
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={pending || po.po_items.length === 0}
              onClick={() => startTransition(async () => { await receivePO(po.id) })}
            >
              Receive all (GRN)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || po.po_items.length === 0}
              onClick={receiveEntered}
            >
              Receive entered
            </Button>
          </div>
        </div>
      ) : po.status === "cancelled" ? (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <XCircleIcon className="size-4" /> Cancelled
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2Icon className="size-4" /> Received · stock updated
        </p>
      )}
    </Card>
  )
}

export function PurchasingManager({
  currency,
  suppliers,
  items,
  purchaseOrders,
  balances,
  paidByPo,
}: {
  currency: string
  suppliers: Supplier[]
  items: ItemOpt[]
  purchaseOrders: PO[]
  balances: SupplierBalance[]
  /** Total paid against each PO, keyed by po id. */
  paidByPo: Record<string, number>
}) {
  const [supState, supAction, supPending] = useActionState<PurchState, FormData>(createSupplier, undefined)
  const [poState, poAction, poPending] = useActionState<PurchState, FormData>(createPO, undefined)
  const [lineState, lineAction, linePending] = useActionState<PurchState, FormData>(addPOItem, undefined)

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
              <Badge key={s.id} variant="secondary" className="font-normal">
                {s.name}
                {s.phone ? ` · ${s.phone}` : ""}
              </Badge>
            ))
          )}
        </div>
        <form action={supAction} className="flex flex-wrap items-center gap-2">
          <Input name="name" placeholder="Supplier name" aria-label="Supplier name" className="max-w-48" required />
          <Input name="phone" placeholder="Phone" aria-label="Supplier phone" className="max-w-32" />
          <Button type="submit" size="sm" variant="secondary" disabled={supPending}>
            <PlusIcon className="size-4" /> {supPending ? "Adding…" : "Add supplier"}
          </Button>
          <FormError state={supState} />
        </form>
      </section>

      {/* Quick purchase — money, not stock */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Quick purchase</h2>
        <Card className="gap-3 p-4">
          <p className="text-sm text-muted-foreground">
            A receipt that is one total for several things — tissue, plastic, a packet of noodles.
            Records the spend and what you owe, and takes it off the drawer if you paid cash. It
            does <strong>not</strong> change stock counts; use a purchase order for goods you want
            to track.
          </p>
          <div>
            {suppliers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add a supplier above first.</p>
            ) : (
              <PaymentDialog
                currency={currency}
                suppliers={suppliers}
                triggerLabel="Record a purchase"
              />
            )}
          </div>
        </Card>
      </section>

      {/* What you owe */}
      <Payables balances={balances} currency={currency} />

      {/* Create PO */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">New purchase order</h2>
        <form action={poAction} className="flex flex-wrap items-center gap-2">
          <Select name="supplierId">
            <SelectTrigger className="w-full max-w-64" aria-label="Supplier">
              <SelectValue placeholder="Supplier (optional)" />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" disabled={poPending}>
            <PlusIcon className="size-4" /> {poPending ? "Creating…" : "Create PO"}
          </Button>
          <FormError state={poState} />
        </form>
      </section>

      {/* PO list */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Purchase orders</h2>
        {purchaseOrders.length === 0 ? (
          <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
            No purchase orders yet — create one above to restock.
          </Card>
        ) : (
          purchaseOrders.map((po) => (
            <POCard
              key={po.id}
              po={po}
              currency={currency}
              items={items}
              suppliers={suppliers}
              paidCents={paidByPo[po.id] ?? 0}
              lineAction={lineAction}
              linePending={linePending}
            />
          ))
        )}
        <FormError state={lineState} />
      </section>
    </div>
  )
}
