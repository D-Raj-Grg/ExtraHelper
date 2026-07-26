"use client"

import { useState } from "react"

import { money } from "@/lib/format"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/**
 * Refund against a settled bill. Manager-only and audited; the dialog names the
 * amount going back because this moves real money and can't be undone.
 */
export function RefundPanel({
  currency,
  totalCents,
  pending,
  onRefund,
}: {
  currency: string
  totalCents: number
  pending: boolean
  onRefund: (cents: number, reason: string) => void
}) {
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [open, setOpen] = useState(false)

  const cents = Math.round(Number(amount) * 100)
  const valid = Number.isFinite(cents) && cents > 0 && reason.trim().length > 0

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Manager only. Refunds are recorded against your account with the reason.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field className="w-32">
          <FieldLabel htmlFor="refund-amount">Amount ({currency})</FieldLabel>
          <Input
            id="refund-amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={(totalCents / 100).toFixed(2)}
            className="tabular-nums"
          />
        </Field>
        <Field className="min-w-40 flex-1">
          <FieldLabel htmlFor="refund-reason">Reason</FieldLabel>
          <Input
            id="refund-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this is being refunded"
          />
        </Field>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger
            render={
              <Button variant="destructive" disabled={pending || !valid}>
                Refund
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Refund {money(cents || 0, currency)}?</AlertDialogTitle>
              <AlertDialogDescription>
                This returns {money(cents || 0, currency)} to the customer and is recorded against
                your account with the reason “{reason.trim()}”. It can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  setOpen(false)
                  onRefund(cents, reason)
                  setAmount("")
                }}
              >
                Refund {money(cents || 0, currency)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
