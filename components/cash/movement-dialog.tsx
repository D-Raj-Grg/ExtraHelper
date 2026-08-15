"use client"

import { useActionState, useState } from "react"
import { ArrowDownLeftIcon, ArrowUpRightIcon } from "lucide-react"
import { recordMovement, type CashState } from "@/app/(app)/cash/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MOVEMENT_CATEGORY_LABELS, type CashMovement } from "./types"

/**
 * Cash out / cash in entry. Amount, category and a required reason — a payout
 * with no stated reason can't be audited later, which is the whole point of
 * recording it.
 */
export function MovementDialog({
  kind,
  currency,
}: {
  kind: CashMovement["kind"]
  currency: string
}) {
  const [open, setOpen] = useState(false)
  // Dismiss on success from inside the action, not an effect: setState in an
  // effect body triggers a cascading render, and the result is already here.
  const [state, action, pending] = useActionState<CashState, FormData>(
    async (prev, formData) => {
      const result = await recordMovement(prev, formData)
      if (result && "ok" in result) setOpen(false)
      return result
    },
    undefined,
  )

  const isPayout = kind === "payout"
  const Icon = isPayout ? ArrowUpRightIcon : ArrowDownLeftIcon
  const title = isPayout ? "Cash out" : "Cash in"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" className="h-11 flex-1">
            <Icon className="size-4" />
            {title}
          </Button>
        }
      />
      <DialogContent size="sm">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {isPayout
                ? "Money leaving the drawer — a supplier paid, supplies bought, a staff advance."
                : "Money added to the drawer from outside a sale."}
            </DialogDescription>
          </DialogHeader>

          <input type="hidden" name="kind" value={kind} />

          <DialogBody className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor={`amount-${kind}`}>Amount ({currency})</FieldLabel>
              <Input
                id={`amount-${kind}`}
                name="amount"
                type="number"
                inputMode="decimal"
                min={0.01}
                step="0.01"
                required
                className="tabular-nums"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor={`category-${kind}`}>Category</FieldLabel>
              <Select name="category" defaultValue={isPayout ? "supplies" : "other"}>
                <SelectTrigger id={`category-${kind}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MOVEMENT_CATEGORY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor={`note-${kind}`}>What was it for?</FieldLabel>
              <Input id={`note-${kind}`} name="note" required maxLength={280} />
              <FieldDescription>
                Name the supplier or the goods. A manager reviews this before the shift closes.
              </FieldDescription>
            </Field>

            {state && "error" in state ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button type="submit" disabled={pending} className="h-11">
              {pending ? "Recording…" : `Record ${title.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
