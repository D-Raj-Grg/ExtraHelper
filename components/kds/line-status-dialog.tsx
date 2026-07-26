"use client"

import { useState } from "react"
import { XIcon } from "lucide-react"

import { KOT_FLOW, KOT_STATUS_META, type KotStatus } from "@/lib/kds-constants"
import { cn } from "@/lib/utils"
import { StatusIcon } from "@/components/kds/status-icon"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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

/**
 * Change one dish's status, or cancel it.
 *
 * The one-tap button on the line covers the forward path; this is for jumping
 * back (a cook hit Ready too early) and for cancelling. Rows are real radios
 * (ChoiceChip's reasoning: arrow keys and screen-reader state), tall enough to
 * hit mid-service, and each states what the status means so nobody has to learn
 * the ladder.
 *
 * Cancel is a void underneath — manager-gated by the RPC — so `canCancel` is
 * false for a cook and the control simply isn't there. It hands off to a
 * reason-required confirm that names the real consequence.
 */
export function LineStatusDialog({
  open,
  onOpenChange,
  lineId,
  dish,
  status,
  canCancel,
  pending,
  onSave,
  onCancelDish,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The kot_item id — dish names repeat across tickets, so DOM ids key off this. */
  lineId: string
  dish: string
  status: string
  canCancel: boolean
  pending: boolean
  onSave: (status: KotStatus) => void
  onCancelDish: (reason: string) => void
}) {
  const [choice, setChoice] = useState<string>(status)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reason, setReason] = useState("")

  // Re-seed during render, not in an effect: if another terminal moves this
  // dish while the dialog is open, an effect would paint the stale choice for a
  // frame — and saving it would silently undo their bump.
  const [seed, setSeed] = useState(status)
  if (seed !== status) {
    setSeed(status)
    setChoice(status)
  }

  return (
    <>
      {/* Hidden, not unmounted, while the confirm is up: the parent holds this
          dialog open by line id, so closing it here would tear the confirm down
          with it before anyone could read the consequence. */}
      <Dialog open={open && !confirmOpen} onOpenChange={onOpenChange}>
        <DialogContent size="md">
          <DialogHeader className="pr-12">
            <DialogTitle className="text-lg">Change status</DialogTitle>
            <p className="truncate text-sm text-muted-foreground">{dish}</p>
          </DialogHeader>

          <DialogBody>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Status for {dish}</legend>
              {KOT_FLOW.map((s) => {
                const meta = KOT_STATUS_META[s]
                const active = choice === s
                return (
                  <label
                    key={s}
                    className={cn(
                      "flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border-2 px-3 py-2",
                      "transition-colors motion-reduce:transition-none",
                      "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                      active ? "border-primary bg-primary/5" : "border-border hover:border-ring/50",
                    )}
                  >
                    <input
                      type="radio"
                      name={`kds-line-status-${lineId}`}
                      className="sr-only"
                      checked={active}
                      onChange={() => setChoice(s)}
                    />
                    <span
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-lg",
                        meta.style,
                      )}
                    >
                      <StatusIcon status={s} className="size-5" />
                    </span>
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="text-base font-semibold">{meta.label}</span>
                      <span className="text-sm text-muted-foreground">{meta.hint}</span>
                    </span>
                  </label>
                )
              })}
            </fieldset>

            {canCancel ? (
              <Button
                type="button"
                variant="ghost"
                className="mt-3 min-h-11 w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmOpen(true)}
              >
                <XIcon className="size-4" />
                Cancel this dish
              </Button>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
              Discard
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={pending || choice === status}
              onClick={() => {
                onSave(choice as KotStatus)
                onOpenChange(false)
              }}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          setConfirmOpen(o)
          // Backing out of the confirm returns to the status picker, not to the
          // board — the cook may still want to move the dish instead.
          if (!o) setReason("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {dish}?</AlertDialogTitle>
            <AlertDialogDescription>
              The kitchen is told to stop, the line drops off the bill, and any stock it deducted is
              returned. This is recorded against your name and can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Field className="px-4">
            <FieldLabel htmlFor={`kds-cancel-reason-${lineId}`}>Reason</FieldLabel>
            <Input
              id={`kds-cancel-reason-${lineId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Guest changed their mind"
            />
          </Field>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setReason("")}>Keep cooking</AlertDialogCancel>
            <AlertDialogAction
              disabled={!reason.trim() || pending}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                onCancelDish(reason.trim())
                setReason("")
                setConfirmOpen(false)
              }}
            >
              Cancel dish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
