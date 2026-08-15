"use client"

import { useActionState } from "react"
import { CheckIcon, XIcon, ZapIcon } from "lucide-react"
import { approveMovement, rejectMovement, type CashState } from "@/app/(app)/cash/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { money } from "@/lib/format"
import { MovementDialog } from "./movement-dialog"
import { MOVEMENT_CATEGORY_LABELS, type CashMovement } from "./types"

function StatusBadge({ movement }: { movement: CashMovement }) {
  if (movement.status === "rejected")
    return (
      <Badge className="gap-1 bg-destructive/10 text-destructive">
        <XIcon className="size-3.5" />
        Rejected
      </Badge>
    )
  if (movement.status === "pending")
    return (
      <Badge className="gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-400">
        Pending
      </Badge>
    )
  return (
    <Badge className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
      {movement.auto_approved ? (
        <ZapIcon className="size-3.5" />
      ) : (
        <CheckIcon className="size-3.5" />
      )}
      {movement.auto_approved ? "Auto-approved" : "Approved"}
    </Badge>
  )
}

function ReviewButtons({ id }: { id: string }) {
  const [approveState, approve, approving] = useActionState<CashState, FormData>(
    approveMovement,
    undefined,
  )
  const [rejectState, reject, rejecting] = useActionState<CashState, FormData>(
    rejectMovement,
    undefined,
  )
  const error =
    (approveState && "error" in approveState && approveState.error) ||
    (rejectState && "error" in rejectState && rejectState.error) ||
    null

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex justify-end gap-2">
        <form action={approve}>
          <input type="hidden" name="movementId" value={id} />
          <Button
            type="submit"
            size="icon"
            className="size-11"
            disabled={approving}
            aria-label="Approve this movement"
          >
            <CheckIcon className="size-4" />
          </Button>
        </form>
        <form action={reject}>
          <input type="hidden" name="movementId" value={id} />
          <Button
            type="submit"
            size="icon"
            variant="outline"
            className="size-11"
            disabled={rejecting}
            aria-label="Reject this movement"
          >
            <XIcon className="size-4" />
          </Button>
        </form>
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Cash in and out of the open drawer.
 *
 * Deliberately shows no expected total, no cash sales, and nothing derived from
 * them: the close reveals expected only after the count is submitted, so the
 * count stays honest. Movement amounts are safe — the cashier handed that money
 * over and already knows it.
 */
export function MovementsPanel({
  movements,
  currency,
  canApprove,
}: {
  movements: CashMovement[]
  currency: string
  canApprove: boolean
}) {
  const counted = movements.filter((m) => m.status !== "rejected")
  const out = counted
    .filter((m) => m.kind === "payout")
    .reduce((sum, m) => sum + m.amount_cents, 0)
  const inn = counted
    .filter((m) => m.kind === "paid_in")
    .reduce((sum, m) => sum + m.amount_cents, 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <MovementDialog kind="payout" currency={currency} />
        <MovementDialog kind="paid_in" currency={currency} />
      </div>

      {movements.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No cash has moved in or out this shift. Record a payout when you pay a supplier or buy
          supplies straight from the drawer — otherwise it shows up as a shortfall at close.
        </p>
      ) : (
        <>
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>What for</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                {canApprove ? <TableHead className="text-right">Review</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="py-1">
                    {m.note}
                    {m.recorded_by ? (
                      <span className="block text-xs text-muted-foreground">{m.recorded_by}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="py-1 text-muted-foreground">
                    {MOVEMENT_CATEGORY_LABELS[m.category]}
                  </TableCell>
                  {/* The sign carries the meaning — colour alone never does. */}
                  <TableCell className="py-1 text-right tabular-nums">
                    {m.status === "rejected" ? (
                      <span className="text-muted-foreground line-through">
                        {money(m.amount_cents, currency)}
                      </span>
                    ) : (
                      <>
                        {m.kind === "payout" ? "−" : "+"}
                        {money(m.amount_cents, currency)}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="py-1">
                    <StatusBadge movement={m} />
                  </TableCell>
                  {canApprove ? (
                    <TableCell className="py-1">
                      {m.status === "pending" ? <ReviewButtons id={m.id} /> : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <p className="text-sm text-muted-foreground tabular-nums">
            Out {money(out, currency)} · In {money(inn, currency)}
          </p>
        </>
      )}
    </div>
  )
}
