"use client"

import { useState } from "react"
import Link from "next/link"
import { PlusIcon } from "lucide-react"
import {
  cancelPO,
  deletePO,
  getPOLines,
  reopenPO,
  sendPO,
  type PurchState,
} from "@/app/(app)/purchasing/actions"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime, money } from "@/lib/format"
import { ConfirmButton } from "./confirm-button"
import { POSheet } from "./po-sheet"
import {
  OutstandingCell,
  StatusBadge,
  orderedCents,
  receivedCents,
  type ItemOpt,
  type PO,
  type POLine,
  type Supplier,
} from "./types"

export function OrdersTab({
  currency,
  timezone,
  purchaseOrders,
  poCount,
  poPage,
  poPageSize,
  showAll,
  suppliers,
  items,
  paidByPo,
  canDelete,
  run,
  runAsync,
  onGoToSuppliers,
}: {
  currency: string
  timezone: string
  purchaseOrders: PO[]
  poCount: number
  poPage: number
  poPageSize: number
  showAll: boolean
  suppliers: Supplier[]
  items: ItemOpt[]
  paidByPo: Record<string, number>
  canDelete: boolean
  run: (fn: () => Promise<PurchState>, ok?: string) => void
  runAsync: (fn: () => Promise<PurchState>, ok?: string) => Promise<boolean>
  onGoToSuppliers: () => void
}) {
  // Held by id, not by object: storing the row freezes a snapshot and
  // revalidated data never appears until the sheet is closed and reopened.
  const [openId, setOpenId] = useState<string | null>(null)
  const [lines, setLines] = useState<POLine[]>([])
  const [loadingLines, setLoadingLines] = useState(false)
  const open = purchaseOrders.find((p) => p.id === openId) ?? null

  // Loaded on the open event rather than in an effect: opening IS the event,
  // and setState inside an effect body triggers a cascading render.
  const loadLines = async (id: string) => {
    setLoadingLines(true)
    try {
      setLines((await getPOLines(id)) as unknown as POLine[])
    } finally {
      setLoadingLines(false)
    }
  }

  const openOrder = (id: string) => {
    setOpenId(id)
    setLines([])
    void loadLines(id)
  }

  if (suppliers.length === 0 && purchaseOrders.length === 0) {
    return (
      <Card className="border-dashed p-8 text-center">
        <p className="font-medium">Add a supplier first</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          An order is placed <em>with</em> someone — the supplier is who you&apos;ll owe and who
          you&apos;ll pay.
        </p>
        <Button className="mt-4 self-center" onClick={onGoToSuppliers}>
          <PlusIcon className="size-4" /> Add a supplier
        </Button>
      </Card>
    )
  }

  if (purchaseOrders.length === 0) {
    return (
      <Card className="border-dashed p-8 text-center">
        <p className="font-medium">{showAll ? "No purchase orders yet" : "Nothing outstanding"}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {showAll
            ? "An order lists what you asked for. Receiving it is what puts the stock on your shelf and adds to what you owe."
            : "Every order has been received or cancelled."}
        </p>
        {!showAll ? (
          <Button variant="outline" className="mt-4 self-center" render={<Link href="?tab=orders&status=all" />}>
            Show all orders
          </Button>
        ) : null}
      </Card>
    )
  }

  const totalPages = Math.max(1, Math.ceil(poCount / poPageSize))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={showAll ? "ghost" : "secondary"}
          render={<Link href="?tab=orders" />}
        >
          Open
        </Button>
        <Button
          size="sm"
          variant={showAll ? "secondary" : "ghost"}
          render={<Link href="?tab=orders&status=all" />}
        >
          All
        </Button>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {poCount} {poCount === 1 ? "order" : "orders"}
        </span>
      </div>

      <Card className="overflow-x-auto p-0">
        <Table className="text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-3 py-2">Supplier</TableHead>
              <TableHead className="px-3 py-2">Status</TableHead>
              <TableHead className="px-3 py-2">Raised</TableHead>
              <TableHead className="px-3 py-2 text-right">Lines</TableHead>
              <TableHead className="px-3 py-2 text-right">Ordered</TableHead>
              <TableHead className="px-3 py-2 text-right">Received</TableHead>
              <TableHead className="px-3 py-2 text-right">Owing</TableHead>
              <TableHead className="px-3 py-2 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchaseOrders.map((po) => (
              <PORow
                key={po.id}
                po={po}
                currency={currency}
                timezone={timezone}
                paidCents={paidByPo[po.id] ?? 0}
                canDelete={canDelete}
                run={run}
                onOpen={() => openOrder(po.id)}
              />
            ))}
          </TableBody>
        </Table>
      </Card>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={poPage <= 1}
            render={
              <Link href={`?tab=orders${showAll ? "&status=all" : ""}&page=${poPage - 1}`} />
            }
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            Page {poPage} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={poPage >= totalPages}
            render={
              <Link href={`?tab=orders${showAll ? "&status=all" : ""}&page=${poPage + 1}`} />
            }
          >
            Next
          </Button>
        </div>
      ) : null}

      <POSheet
        po={open}
        lines={lines}
        loading={loadingLines}
        onReload={() => openId && void loadLines(openId)}
        currency={currency}
        items={items}
        suppliers={suppliers}
        paidCents={open ? (paidByPo[open.id] ?? 0) : 0}
        canDelete={canDelete}
        runAsync={runAsync}
        onOpenChange={(o) => !o && setOpenId(null)}
      />
    </div>
  )
}

/** Module scope: nested in the parent it would remount on every render. */
function PORow({
  po,
  currency,
  timezone,
  paidCents,
  canDelete,
  run,
  onOpen,
}: {
  po: PO
  currency: string
  timezone: string
  paidCents: number
  canDelete: boolean
  run: (fn: () => Promise<PurchState>, ok?: string) => void
  onOpen: () => void
}) {
  const ordered = orderedCents(po)
  const received = receivedCents(po)
  const owing = received - paidCents
  const name = po.suppliers?.name ?? "No supplier"
  const hasReceipt = po.po_items.some((l) => Number(l.qty_received) > 0)

  return (
    <TableRow>
      <TableCell className="px-3 py-2 font-medium">{name}</TableCell>
      <TableCell className="px-3 py-2">
        <StatusBadge status={po.status} />
      </TableCell>
      <TableCell className="px-3 py-2 whitespace-nowrap text-muted-foreground">
        {formatDateTime(po.created_at, timezone)}
      </TableCell>
      <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {po.po_items.length}
      </TableCell>
      <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {money(ordered, currency)}
      </TableCell>
      <TableCell className="px-3 py-2 text-right tabular-nums">
        {money(received, currency)}
      </TableCell>
      <TableCell className="px-3 py-2 text-right tabular-nums">
        {received > 0 ? (
          <OutstandingCell cents={owing} money={money(Math.abs(owing), currency)} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="px-3 py-2">
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onOpen}>
            Open
          </Button>

          {po.status === "draft" ? (
            <Button size="sm" onClick={() => run(() => sendPO(po.id), `Order sent to ${name}.`)}>
              Send
            </Button>
          ) : null}

          {po.status === "sent" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => run(() => reopenPO(po.id), "Back to draft — you can edit it again.")}
            >
              Reopen
            </Button>
          ) : null}

          {(po.status === "draft" || po.status === "sent") && !hasReceipt ? (
            <ConfirmButton
              label="Cancel"
              variant="ghost"
              title={`Cancel this order to ${name}?`}
              description={
                po.status === "sent"
                  ? "It stays in your history marked cancelled and stops counting toward what you owe. Nothing has arrived, so no stock changes."
                  : "Nothing was sent and no stock moved. It stays in your history marked cancelled."
              }
              confirmLabel="Cancel order"
              onConfirm={() => run(() => cancelPO(po.id, ""), "Order cancelled.")}
            />
          ) : null}

          {po.status === "draft" && !hasReceipt && canDelete ? (
            <ConfirmButton
              label="Delete"
              variant="ghost"
              destructive
              title="Delete this draft?"
              description={`Nothing was sent to ${name} and no stock moved, so nothing is lost. This can't be undone.`}
              confirmLabel="Delete draft"
              onConfirm={() => run(() => deletePO(po.id), "Draft deleted.")}
            />
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}
