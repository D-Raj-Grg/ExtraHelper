"use client"

import { useState } from "react"
import { PrinterCheckIcon, PrinterIcon } from "lucide-react"

import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { orderTypeLabel } from "@/lib/order-constants"
import { kotStatusLabel, KOT_FLOW, KOT_STATUS_STYLE } from "@/lib/kds-constants"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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

/** Dropdown sentinel — selecting it opens the reason dialog rather than setting a status. */
export const CANCEL_VALUE = "__cancel__"

/** A modifier on a ticket line. */
export type KotTicketMod = { name_snapshot: string; qty: number }

/** One line on a ticket, void-aware. `orderItemId` is what voidLine acts on. */
export type KotTicketLine = {
  id: string
  orderItemId: string | null
  name: string
  qty: number
  isVoid: boolean
  notes: string | null
  mods: KotTicketMod[]
}

/**
 * A ticket as the KOT tab renders it — one physical KOT in split mode, or one
 * order's merged stations in combined mode. `kotIds` is what a status change or
 * a print applies to; `orderId` is what a cancel (line void) applies to.
 */
export type KotTicket = {
  key: string
  kotIds: string[]
  orderId: string | null
  number: string
  station: string | null
  tableLabel: string | null
  orderType: string
  staffName: string
  createdAt: string
  printed: boolean
  status: string
  /** False once the order is billed/closed — voiding a billed line can't recompute a paid bill. */
  canCancel: boolean
  lines: KotTicketLine[]
}

/**
 * One kitchen order ticket, cashier-facing. Mirrors the printed KOT: table and
 * meta up top, an itemised table (every column a header, qty right-aligned and
 * tabular), then a total and the two controls a till needs — advance status and
 * (re)print. The printed-✓ badge is driven by printed_at, not the button, so a
 * ticket printed on another terminal still reads as printed here.
 */
export function KotCard({
  ticket,
  timeZone,
  pending,
  onStatus,
  onPrint,
  onCancel,
}: {
  ticket: KotTicket
  timeZone: string
  pending: boolean
  onStatus: (status: string) => void
  onPrint: () => void
  onCancel: (reason: string) => void
}) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState("")

  const activeLines = ticket.lines.filter((l) => !l.isVoid)
  const dishes = activeLines.length
  const qty = activeLines.reduce((n, l) => n + l.qty, 0)
  // Nothing left to void ⇒ no cancel offered (already fully voided).
  const cancellable = ticket.canCancel && activeLines.length > 0

  function onSelectStatus(v: string) {
    if (v === CANCEL_VALUE) {
      setCancelOpen(true)
      return
    }
    onStatus(v)
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="text-center">
        <p className="text-lg font-bold leading-tight">{ticket.number}</p>
        <p className="text-sm text-muted-foreground">
          {ticket.tableLabel ? `Table: ${ticket.tableLabel}` : orderTypeLabel(ticket.orderType)}
          {ticket.station ? ` · ${ticket.station}` : ""}
        </p>
      </div>

      <dl className="space-y-0.5 text-sm">
        <Meta term="Type" value={orderTypeLabel(ticket.orderType)} />
        <Meta term="Order By" value={ticket.staffName} />
        <Meta term="Order At" value={formatDateTime(ticket.createdAt, timeZone)} />
      </dl>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">S.N</TableHead>
            <TableHead>Dishes</TableHead>
            <TableHead className="text-right">QTY</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ticket.lines.map((l, i) => (
            <TableRow key={l.id}>
              <TableCell className="align-top tabular-nums text-muted-foreground">
                {i + 1}.
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                <span className={cn(l.isVoid && "text-muted-foreground line-through decoration-destructive")}>
                  {l.name}
                </span>
                {l.isVoid ? (
                  <Badge className="ml-1.5 border-transparent bg-destructive/10 text-destructive no-underline">
                    Void
                  </Badge>
                ) : null}
                {l.mods.map((m, mi) => (
                  <span key={mi} className="block pl-3 text-xs text-muted-foreground">
                    + {m.name_snapshot}
                    {m.qty > 1 ? ` ×${m.qty}` : ""}
                  </span>
                ))}
                {l.notes ? (
                  <span className="block pl-3 text-xs italic text-muted-foreground">** {l.notes}</span>
                ) : null}
              </TableCell>
              <TableCell className="align-top text-right tabular-nums">{l.qty}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
        <span>Total (Dishes/QTY)</span>
        <span className="tabular-nums">
          {dishes}/{qty}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <Select
          value={ticket.status}
          onValueChange={(v) => onSelectStatus(String(v))}
          disabled={pending}
        >
          <SelectTrigger aria-label="Ticket status" className="min-h-11 flex-1">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex rounded px-1.5 py-0.5 text-xs font-semibold",
                  KOT_STATUS_STYLE[ticket.status] ?? "bg-muted",
                )}
              >
                <SelectValue />
              </span>
            </span>
          </SelectTrigger>
          <SelectContent>
            {KOT_FLOW.map((s) => (
              <SelectItem key={s} value={s}>
                {kotStatusLabel(s)}
              </SelectItem>
            ))}
            {cancellable ? (
              <SelectItem value={CANCEL_VALUE} className="text-destructive">
                Cancel ticket…
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={onPrint}
          aria-label={ticket.printed ? "Reprint ticket" : "Print ticket"}
        >
          {ticket.printed ? (
            <PrinterCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <PrinterIcon className="size-4" />
          )}
          {ticket.printed ? "Printed" : "Print"}
        </Button>
      </div>

      <AlertDialog
        open={cancelOpen}
        onOpenChange={(o) => {
          setCancelOpen(o)
          if (!o) setReason("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel {ticket.number}
              {ticket.tableLabel ? ` · Table ${ticket.tableLabel}` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All {dishes} {dishes === 1 ? "dish" : "dishes"} on this ticket are voided — the kitchen
              is told to stop and any deducted stock is returned. This is recorded against your name
              and can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Field className="px-4">
            <FieldLabel htmlFor={`kot-cancel-reason-${ticket.key}`}>Reason</FieldLabel>
            <Input
              id={`kot-cancel-reason-${ticket.key}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Guest cancelled the order"
            />
          </Field>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setReason("")}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={!reason.trim() || pending}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                onCancel(reason.trim())
                setReason("")
                setCancelOpen(false)
              }}
            >
              Cancel ticket
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function Meta({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground">{term}:</dt>
      <dd className="min-w-0 flex-1 truncate font-medium">{value}</dd>
    </div>
  )
}
