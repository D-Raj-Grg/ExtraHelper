"use client"

import { useState } from "react"
import { MinusIcon, PauseIcon, PlayIcon, PlusIcon, Trash2Icon, XCircleIcon } from "lucide-react"

import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { cartLineTitle, type CartController, type CartLine } from "@/components/pos/cart-types"

/**
 * One line in the cart rail.
 *
 * Mode-blind by construction: it asks the controller what it *can* do
 * (`setHold` present? `canDelete`?) rather than what mode it's in. That's why
 * the same row works for a local draft and a fired kitchen line.
 */
export function CartLineRow({
  line,
  cart,
  currency,
}: {
  line: CartLine
  cart: CartController
  currency: string
}) {
  const [voidOpen, setVoidOpen] = useState(false)
  const deletable = cart.canDelete(line.lineId)
  const title = cartLineTitle(line)

  return (
    <li className="flex flex-col gap-2 border-b p-3 last:border-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{title}</p>
          {line.modifierNames.length ? (
            <p className="text-xs text-muted-foreground">{line.modifierNames.join(", ")}</p>
          ) : null}
          <p className="text-xs text-muted-foreground tabular-nums">
            @ {money(line.unitPriceCents, currency)}
            {line.course ? ` · Course ${line.course}` : ""}
            {line.seat ? ` · Seat ${line.seat}` : ""}
          </p>
          {line.isHeld ? (
            <Badge variant="secondary" className="mt-1 gap-1">
              <PauseIcon className="size-3" aria-hidden />
              Held back
            </Badge>
          ) : null}
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums">
          {money(line.unitPriceCents * line.qty, currency)}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={`One fewer ${title}`}
          disabled={cart.busy || (line.qty <= 1 && !deletable)}
          onClick={() => cart.setQty(line.lineId, line.qty - 1)}
        >
          <MinusIcon />
        </Button>
        <span
          aria-live="polite"
          aria-label={`${line.qty} × ${title}`}
          className="min-w-10 text-center text-base font-semibold tabular-nums"
        >
          {line.qty}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={`One more ${title}`}
          disabled={cart.busy || line.qty >= 99}
          onClick={() => cart.setQty(line.lineId, line.qty + 1)}
        >
          <PlusIcon />
        </Button>

        <div className="ml-auto flex items-center gap-1">
          {/* Present only when the controller can hold — i.e. amend mode. */}
          {cart.setHold ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={line.isHeld ? `Release ${title} to the kitchen` : `Hold ${title} back`}
              disabled={cart.busy}
              onClick={() => cart.setHold?.(line.lineId, !line.isHeld)}
            >
              {line.isHeld ? <PlayIcon /> : <PauseIcon />}
            </Button>
          ) : null}

          {deletable ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 text-destructive"
              aria-label={`Remove ${title}`}
              disabled={cart.busy}
              onClick={() => cart.remove(line.lineId)}
            >
              <Trash2Icon />
            </Button>
          ) : cart.voidLine ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 text-destructive"
              aria-label={`Void ${title}`}
              disabled={cart.busy}
              onClick={() => setVoidOpen(true)}
            >
              <XCircleIcon />
            </Button>
          ) : null}
        </div>
      </div>

      <RemarksInput line={line} cart={cart} />

      {cart.voidLine ? (
        <VoidDialog
          open={voidOpen}
          onOpenChange={setVoidOpen}
          line={line}
          currency={currency}
          onConfirm={(reason) => cart.voidLine?.(line.lineId, reason)}
        />
      ) : null}
    </li>
  )
}

/**
 * Remarks, held locally and committed on blur.
 *
 * Local state is the point: in amend mode every edit is a server round trip, and
 * firing one per keystroke would fight the waiter's typing. Seeded by lineId so
 * a *different* line reuses the component cleanly, while the live value doesn't
 * stomp what's being typed.
 */
function RemarksInput({ line, cart }: { line: CartLine; cart: CartController }) {
  const title = cartLineTitle(line)
  const [draft, setDraft] = useState(line.notes ?? "")
  const [editingId, setEditingId] = useState(line.lineId)

  if (editingId !== line.lineId) {
    setEditingId(line.lineId)
    setDraft(line.notes ?? "")
  }

  return (
    <Input
      aria-label={`Remarks for ${title}`}
      placeholder="Add remarks to dish"
      value={draft}
      disabled={cart.busy}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim() || null
        if (next !== (line.notes ?? null)) cart.patch(line.lineId, { notes: next })
      }}
      className="h-9 text-sm"
    />
  )
}

/**
 * Voids are audited and restore stock — they are not a delete. Name the real
 * consequence and take a reason, rather than the bare inline input this used to
 * be.
 */
function VoidDialog({
  open,
  onOpenChange,
  line,
  currency,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  line: CartLine
  currency: string
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState("")

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Void {line.qty} × {cartLineTitle(line)}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {/* Explicit {" "}: a bare space between an expression and the text
                that follows it doesn't survive the JSX transform here, which
                rendered "NPR 1,080.00comes off the bill". */}
            {money(line.unitPriceCents * line.qty, currency)}{" "}
            comes off the bill and the kitchen is told to stop. This is recorded against your name
            and can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Field className="px-4">
          <FieldLabel htmlFor={`void-reason-${line.lineId}`}>Reason</FieldLabel>
          <Input
            id={`void-reason-${line.lineId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Guest changed their mind"
          />
        </Field>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setReason("")}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            disabled={!reason.trim()}
            className={cn("bg-destructive text-white hover:bg-destructive/90")}
            onClick={() => {
              onConfirm(reason.trim())
              setReason("")
            }}
          >
            Void it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
