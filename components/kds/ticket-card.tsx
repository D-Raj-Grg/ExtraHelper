"use client"

import { useState } from "react"
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ClockIcon,
  ExternalLinkIcon,
  PencilIcon,
  PrinterCheckIcon,
  PrinterIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react"

import {
  kotStatusLabel,
  kotStatusMeta,
  nextKotStatus,
  ticketAge,
  KOT_STATUS_STYLE,
  type KotStatus,
} from "@/lib/kds-constants"
import { cn } from "@/lib/utils"
import { isLive, type KdsKot, type KdsLine } from "@/components/kds/types"
import { LineStatusDialog } from "@/components/kds/line-status-dialog"
import { usePrint } from "@/components/print/use-print"
import { StatusIcon } from "@/components/kds/status-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export type TicketActions = {
  onLineStatus: (lineId: string, status: KotStatus) => void
  onCancelLine: (orderItemId: string, reason: string) => void
  onBump: (next: KotStatus) => void
  onCancelTicket: (reason: string) => void
  onRecall?: () => void
}

/**
 * One kitchen ticket. Read across a hot room at a glance, so the table is the
 * loudest thing on it and quantities lead each line.
 *
 * The dish is the unit of work: each line carries its own status with a
 * one-tap advance (the fast path a cook actually uses) and a pencil for the
 * full picker. The ticket footer still bumps everything at once for the common
 * case where a whole ticket lands together.
 */
export function TicketCard({
  kot,
  now,
  pending,
  canVoid,
  canBump,
  muted = false,
  actions,
}: {
  kot: KdsKot
  now: number
  pending: boolean
  /** Manager-only: voids are gated by the RPC, so a cook never sees the control. */
  canVoid: boolean
  /** kds.bump — a cashier can watch the board but can't move a dish on it. */
  canBump: boolean
  /** Completed tickets sit quieter — no age alarm, no primary bump. */
  muted?: boolean
  actions: TicketActions
}) {
  const { printKot } = usePrint()
  const [editing, setEditing] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState("")

  const age = ticketAge(kot.created_at, now)
  const table = kot.orders?.restaurant_tables?.label
  const where = table ? `Table ${table}` : "Takeaway"
  const next = nextKotStatus(kot.status)
  const liveLines = kot.kot_items.filter(isLive)
  // Hold the open editor by id and derive the row from the live list — storing
  // the row freezes a snapshot, so a Realtime update never reaches the dialog.
  const editingLine = kot.kot_items.find((l) => l.id === editing) ?? null

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border-2 bg-card p-3",
        muted ? "border-border/70 bg-card/60" : age.border,
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xl font-bold leading-tight">{where}</p>
          <p className="truncate text-sm text-muted-foreground">
            {kot.kitchen_stations?.name ?? "Expo"}
          </p>
        </div>
        {/* Age carries an icon + minutes, not just a border colour. */}
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 text-sm font-semibold",
            muted ? "text-muted-foreground" : age.text,
          )}
        >
          {age.late && !muted ? (
            <AlertTriangleIcon className="size-4" aria-hidden />
          ) : (
            <ClockIcon className="size-4" aria-hidden />
          )}
          <span className="tabular-nums">{age.label}</span>
        </span>
      </div>

      <ul className="mb-3 flex flex-1 flex-col divide-y divide-border/60">
        {kot.kot_items.map((line) => (
          <TicketLine
            key={line.id}
            line={line}
            pending={pending}
            canBump={canBump}
            onAdvance={(status) => actions.onLineStatus(line.id, status)}
            onEdit={() => setEditing(line.id)}
          />
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 border-t pt-2">
        <Badge className={cn("border-transparent gap-1", KOT_STATUS_STYLE[kot.status] ?? "bg-muted")}>
          <StatusIcon status={kot.status} className="size-3.5" />
          {kotStatusLabel(kot.status)}
        </Badge>

        {/* Split button: the station printer is the default; the browser view is
            the escape hatch when the agent is down or a printer isn't set up. */}
        <div className="ml-auto flex items-center">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-r-none border-r-0"
            onClick={() => void printKot(kot.id, { reprint: Boolean(kot.printed_at) })}
          >
            {kot.printed_at ? (
              <PrinterCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <PrinterIcon className="size-4" />
            )}
            {kot.printed_at ? "Reprint" : "Print"}
            <span className="sr-only"> the {where} ticket</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-11 w-9 rounded-l-none"
                  aria-label={`More print options for the ${where} ticket`}
                />
              }
            >
              <ChevronDownIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => void printKot(kot.id, { reprint: Boolean(kot.printed_at) })}
              >
                <PrinterIcon className="size-4" />
                Send to the station printer
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => window.open(`/kot/${kot.id}`, "_blank", "noopener")}
              >
                <ExternalLinkIcon className="size-4" />
                Open the browser print view
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {canVoid && liveLines.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Cancel the ${where} ticket`}
            disabled={pending}
            onClick={() => setCancelOpen(true)}
          >
            <XIcon className="size-4" />
          </Button>
        ) : null}

        {muted && actions.onRecall ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            disabled={pending}
            onClick={actions.onRecall}
          >
            <Undo2Icon className="size-4" />
            Recall to the board
          </Button>
        ) : next && !muted && canBump ? (
          <Button
            className="h-12 w-full text-base"
            disabled={pending}
            onClick={() => actions.onBump(next)}
          >
            <StatusIcon status={next} />
            {next === "served" ? "Bump all" : `${kotStatusMeta(next)?.action ?? "Bump"} all`}
            <span className="sr-only"> dishes on the {where} ticket</span>
          </Button>
        ) : null}
      </div>

      {editingLine ? (
        <LineStatusDialog
          open={Boolean(editing)}
          onOpenChange={(o) => setEditing(o ? editing : null)}
          lineId={editingLine.id}
          dish={editingLine.order_items?.name_snapshot ?? "Dish"}
          status={editingLine.status}
          canCancel={canVoid && isLive(editingLine) && Boolean(editingLine.order_items?.id)}
          pending={pending}
          onSave={(status) => actions.onLineStatus(editingLine.id, status)}
          onCancelDish={(why) => {
            const orderItemId = editingLine.order_items?.id
            if (orderItemId) actions.onCancelLine(orderItemId, why)
            setEditing(null)
          }}
        />
      ) : null}

      <AlertDialog
        open={cancelOpen}
        onOpenChange={(o) => {
          setCancelOpen(o)
          if (!o) setReason("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel the {where} ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              All {liveLines.length} {liveLines.length === 1 ? "dish" : "dishes"} still cooking are
              voided — the kitchen stops, the lines drop off the bill and any stock they deducted is
              returned. This is recorded against your name and can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Field className="px-4">
            <FieldLabel htmlFor={`kds-ticket-cancel-${kot.id}`}>Reason</FieldLabel>
            <Input
              id={`kds-ticket-cancel-${kot.id}`}
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
                actions.onCancelTicket(reason.trim())
                setReason("")
                setCancelOpen(false)
              }}
            >
              Cancel ticket
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** One dish: quantity, name, its modifiers, and its own state. */
function TicketLine({
  line,
  pending,
  canBump,
  onAdvance,
  onEdit,
}: {
  line: KdsLine
  pending: boolean
  canBump: boolean
  onAdvance: (status: KotStatus) => void
  onEdit: () => void
}) {
  const voided = !isLive(line)
  const name = line.order_items?.name_snapshot ?? "item"
  const next = nextKotStatus(line.status)
  const meta = kotStatusMeta(line.status)

  return (
    <li className="flex items-start gap-2 py-1.5">
      <span
        className={cn(
          "shrink-0 pt-2 text-base font-bold tabular-nums",
          voided ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {line.qty}×
      </span>
      <span className="min-w-0 flex-1 pt-1.5">
        <span
          className={cn(
            "text-base leading-snug",
            voided && "text-muted-foreground line-through decoration-destructive",
          )}
        >
          {name}
        </span>
        {line.order_items?.order_item_modifiers?.map((m, i) => (
          <span key={i} className="block text-xs text-muted-foreground">
            + {m.name_snapshot}
            {m.qty > 1 ? ` ×${m.qty}` : ""}
          </span>
        ))}
        {line.order_items?.notes ? (
          <span className="block text-xs italic text-muted-foreground">
            ** {line.order_items.notes}
          </span>
        ) : null}
        {voided ? (
          <span className="mt-0.5 block">
            <Badge className="border-transparent bg-destructive/10 text-destructive no-underline">
              Cancelled
              {line.order_items?.void_reason ? ` · ${line.order_items.void_reason}` : ""}
            </Badge>
          </span>
        ) : null}
      </span>

      {voided ? null : (
        <span className="flex shrink-0 items-center gap-1">
          {next && canBump ? (
            // Tinted with the status it moves the dish *into* — the button's
            // colour, icon and verb must all describe the same thing.
            <Button
              type="button"
              variant="outline"
              className={cn("h-11 gap-1.5 px-2.5", kotStatusMeta(next)?.style)}
              disabled={pending}
              onClick={() => onAdvance(next)}
            >
              <StatusIcon status={next} />
              {kotStatusMeta(next)?.action ?? "Bump"}
              <span className="sr-only"> {name}</span>
            </Button>
          ) : (
            <Badge className={cn("border-transparent gap-1 h-11 px-2.5", meta?.style)}>
              <StatusIcon status={line.status} className="size-3.5" />
              {kotStatusLabel(line.status)}
            </Badge>
          )}
          {canBump ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={`Change status of ${name}`}
              onClick={onEdit}
            >
              <PencilIcon className="size-4" />
            </Button>
          ) : null}
        </span>
      )}
    </li>
  )
}
