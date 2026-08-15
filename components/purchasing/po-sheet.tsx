"use client"

import { useState } from "react"
import Link from "next/link"
import { PlusIcon, Trash2Icon } from "lucide-react"
import {
  addPOLine,
  correctPOReceipt,
  createItemAndAddLine,
  deletePOLine,
  receivePO,
  receivePOPartial,
  updatePOLine,
  type PurchState,
} from "@/app/(app)/purchasing/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { money } from "@/lib/format"
import { ConfirmButton } from "./confirm-button"
import { PaymentDialog } from "./payment-dialog"
import { StatusBadge, receivedCents, type ItemOpt, type PO, type POLine } from "./types"

export function POSheet({
  po,
  lines,
  loading,
  onReload,
  currency,
  items,
  paidCents,
  canDelete,
  run,
  onOpenChange,
}: {
  po: PO | null
  /**
   * Fetched by the list when the row is opened, not shipped with every order —
   * that is what lets the orders query stay one shallow page instead of every
   * order with every nested ingredient.
   */
  lines: POLine[]
  loading: boolean
  onReload: () => void
  currency: string
  items: ItemOpt[]
  paidCents: number
  canDelete: boolean
  run: (fn: () => Promise<PurchState>, ok?: string) => void
  onOpenChange: (open: boolean) => void
}) {
  if (!po) return <Sheet open={false} onOpenChange={onOpenChange} />

  const editable = po.status === "draft"
  const receivable = po.status === "sent" || po.status === "partial"
  const received = receivedCents(po)
  const owing = received - paidCents
  const name = po.suppliers?.name ?? "No supplier"

  const reload = onReload

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent size="lg" className="w-full gap-0">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {name} <StatusBadge status={po.status} />
          </SheetTitle>
          <SheetDescription>
            {editable
              ? "A draft — edit freely. Sending it freezes these lines."
              : receivable
                ? "Enter what actually arrived. Receiving puts it on your shelf and adds to what you owe."
                : "Received. Corrections leave both the original and the fix in your history."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6">
          {loading && lines.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">Loading lines…</p>
          ) : lines.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              Nothing on this order yet. Add what you&apos;re buying below.
            </p>
          ) : (
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <LineRow
                    key={l.id}
                    line={l}
                    currency={currency}
                    editable={editable}
                    canCorrect={canDelete && Number(l.qty_received) > 0}
                    run={run}
                    onDone={reload}
                  />
                ))}
              </TableBody>
            </Table>
          )}

          {editable ? (
            <AddLine poId={po.id} items={items} run={run} onDone={reload} />
          ) : null}

          {receivable ? (
            <ReceivePanel po={po} lines={lines} run={run} onDone={reload} />
          ) : null}

          {received > 0 ? (
            <div className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="tabular-nums text-muted-foreground">
                  Received {money(received, currency)} · Paid {money(paidCents, currency)}
                </span>
                {owing > 0 ? (
                  <span className="tabular-nums text-amber-700 dark:text-amber-400">
                    {money(owing, currency)} owing
                  </span>
                ) : (
                  <span className="tabular-nums text-emerald-700 dark:text-emerald-400">
                    Settled
                  </span>
                )}
              </div>
              {po.supplier_id ? (
                <div className="mt-3">
                  <PaymentDialog
                    currency={currency}
                    suppliers={[]}
                    poId={po.id}
                    supplierId={po.supplier_id}
                    triggerLabel="Record payment"
                    outstandingCents={owing}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Need an ingredient set up properly — category, reorder level, barcode?{" "}
            <Link href="/inventory" className="underline underline-offset-4">
              Manage ingredients
            </Link>
            .
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function LineRow({
  line,
  currency,
  editable,
  canCorrect,
  run,
  onDone,
}: {
  line: POLine
  currency: string
  editable: boolean
  canCorrect: boolean
  run: (fn: () => Promise<PurchState>, ok?: string) => void
  onDone: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [qty, setQty] = useState(String(line.qty_ordered))
  const [cost, setCost] = useState((line.unit_cost_cents / 100).toFixed(2))
  const itemName = line.inventory_items?.name ?? "Removed ingredient"
  const uom = line.inventory_items?.uom ?? ""

  if (editing)
    return (
      <TableRow>
        <TableCell className="py-1">{itemName}</TableCell>
        <TableCell className="py-1 text-right">
          <Input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            type="number"
            step="0.001"
            min={0}
            aria-label={`Quantity ordered for ${itemName}`}
            className="ml-auto h-9 w-20 text-right tabular-nums"
          />
        </TableCell>
        <TableCell className="py-1 text-right tabular-nums text-muted-foreground">
          {Number(line.qty_received)}
        </TableCell>
        <TableCell className="py-1 text-right">
          <Input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            type="number"
            step="0.01"
            min={0}
            aria-label={`Unit cost for ${itemName}`}
            className="ml-auto h-9 w-24 text-right tabular-nums"
          />
        </TableCell>
        <TableCell className="py-1">
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              onClick={() => {
                run(
                  () => updatePOLine(line.id, Number(qty), Number(cost)),
                  `${itemName} updated.`,
                )
                setEditing(false)
                setTimeout(onDone, 300)
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )

  return (
    <TableRow>
      <TableCell className="py-1">{itemName}</TableCell>
      <TableCell className="py-1 text-right tabular-nums text-muted-foreground">
        {Number(line.qty_ordered)} {uom}
      </TableCell>
      <TableCell className="py-1 text-right tabular-nums">
        {Number(line.qty_received)} {uom}
      </TableCell>
      <TableCell className="py-1 text-right tabular-nums text-muted-foreground">
        {money(line.unit_cost_cents, currency)}
      </TableCell>
      <TableCell className="py-1">
        <div className="flex justify-end gap-2">
          {editable ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                aria-label={`Remove ${itemName}`}
                onClick={() => {
                  run(() => deletePOLine(line.id), `${itemName} removed.`)
                  setTimeout(onDone, 300)
                }}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </>
          ) : null}
          {canCorrect ? (
            <CorrectLine line={line} currency={currency} run={run} onDone={onDone} />
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

/** Correction, not undo — the original receipt stays, a compensating one is added. */
function CorrectLine({
  line,
  currency,
  run,
  onDone,
}: {
  line: POLine
  currency: string
  run: (fn: () => Promise<PurchState>, ok?: string) => void
  onDone: () => void
}) {
  const [qty, setQty] = useState(String(line.qty_received))
  const [cost, setCost] = useState((line.unit_cost_cents / 100).toFixed(2))
  const [reason, setReason] = useState("")
  const name = line.inventory_items?.name ?? "this line"
  const delta = Number(qty) - Number(line.qty_received)

  return (
    <ConfirmButton
      label="Correct"
      variant="ghost"
      title={`Correct what arrived for ${name}?`}
      confirmLabel="Record correction"
      description={
        <span className="block space-y-3">
          <span className="block">
            Stock changes by {delta > 0 ? "+" : ""}
            {delta || 0}. The original receipt stays in your history and a correction is added
            beside it. Last-known cost isn&apos;t restored — receiving overwrote it and the old
            figure was never stored.
          </span>
          <span className="grid grid-cols-2 gap-2">
            <Input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              type="number"
              step="0.001"
              min={0}
              aria-label="Actual quantity received"
              className="tabular-nums"
            />
            <Input
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              type="number"
              step="0.01"
              min={0}
              aria-label={`Unit cost in ${currency}`}
              className="tabular-nums"
            />
          </span>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What went wrong?"
            aria-label="Reason for the correction"
          />
        </span>
      }
      onConfirm={() => {
        run(
          () => correctPOReceipt(line.id, Number(qty), Number(cost), reason),
          `${name} corrected.`,
        )
        setTimeout(onDone, 300)
      }}
    />
  )
}

function AddLine({
  poId,
  items,
  run,
  onDone,
}: {
  poId: string
  items: ItemOpt[]
  run: (fn: () => Promise<PurchState>, ok?: string) => void
  onDone: () => void
}) {
  const [itemId, setItemId] = useState("")
  const [qty, setQty] = useState("")
  const [cost, setCost] = useState("")
  const [newName, setNewName] = useState("")
  const [newUom, setNewUom] = useState("unit")
  const creating = itemId === "__new"

  const reset = () => {
    setItemId("")
    setQty("")
    setCost("")
    setNewName("")
    setNewUom("unit")
  }

  return (
    <div className="rounded-lg border p-4">
      <p className="mb-3 text-sm font-medium">Add a line</p>
      <div className="flex flex-col gap-2">
        <Select value={itemId} onValueChange={(v) => setItemId(String(v))}>
          <SelectTrigger className="w-full" aria-label="Ingredient">
            <SelectValue placeholder="Select ingredient" />
          </SelectTrigger>
          <SelectContent>
            {items.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.name}
              </SelectItem>
            ))}
            {/* The main reason a 20 rupee packet never gets logged is having to
                leave the screen to create it first. */}
            <SelectItem value="__new">+ New ingredient…</SelectItem>
          </SelectContent>
        </Select>

        {creating ? (
          <div className="flex flex-wrap gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ingredient name"
              aria-label="New ingredient name"
              className="min-w-40 flex-1"
            />
            <Input
              value={newUom}
              onChange={(e) => setNewUom(e.target.value)}
              placeholder="Unit"
              aria-label="Unit of measure"
              className="w-24"
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            type="number"
            step="0.001"
            min={0}
            placeholder="Qty"
            aria-label="Quantity"
            className="h-9 w-24 text-right tabular-nums"
          />
          <Input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            type="number"
            step="0.01"
            min={0}
            placeholder="Unit cost"
            aria-label="Unit cost"
            className="h-9 w-28 text-right tabular-nums"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!itemId || !qty || (creating && !newName.trim())}
            onClick={() => {
              const q = Number(qty)
              const c = Number(cost)
              if (creating) {
                run(
                  () => createItemAndAddLine(poId, newName, newUom, q, c),
                  `${newName.trim()} created and added.`,
                )
              } else {
                run(
                  () => addPOLine(poId, itemId, q, c),
                  "Line added — adding the same ingredient again tops it up.",
                )
              }
              reset()
              setTimeout(onDone, 300)
            }}
          >
            <PlusIcon className="size-4" /> Add line
          </Button>
        </div>
      </div>
    </div>
  )
}

function ReceivePanel({
  po,
  lines,
  run,
  onDone,
}: {
  po: PO
  lines: POLine[]
  run: (fn: () => Promise<PurchState>, ok?: string) => void
  onDone: () => void
}) {
  const outstanding = (l: POLine) =>
    Math.max(0, Number(l.qty_ordered) - Number(l.qty_received))
  const [entered, setEntered] = useState<Record<string, string>>({})

  return (
    <div className="rounded-lg border p-4">
      <p className="mb-3 text-sm font-medium">Receive</p>
      <div className="flex flex-col gap-2">
        {lines.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
            <span>{l.inventory_items?.name}</span>
            <Input
              type="number"
              step="0.001"
              min={0}
              value={entered[l.id] ?? String(outstanding(l))}
              onChange={(e) => setEntered((p) => ({ ...p, [l.id]: e.target.value }))}
              aria-label={`Quantity received for ${l.inventory_items?.name ?? "item"}`}
              className="h-9 w-24 text-right tabular-nums"
              disabled={outstanding(l) === 0}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => {
            run(() => receivePO(po.id), "Everything received — stock updated.")
            setTimeout(onDone, 300)
          }}
        >
          Receive all
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const payload = lines
              .map((l) => ({
                po_item_id: l.id,
                qty: Number(entered[l.id] ?? outstanding(l)),
              }))
              .filter((l) => Number.isFinite(l.qty) && l.qty > 0)
            run(() => receivePOPartial(po.id, payload), "Received — stock updated.")
            setTimeout(onDone, 300)
          }}
        >
          Receive entered
        </Button>
      </div>
    </div>
  )
}
