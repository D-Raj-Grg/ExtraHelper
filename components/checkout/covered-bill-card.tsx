"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CheckIcon } from "lucide-react"

import { closeCoveredBill, refundBill } from "@/app/(app)/bill/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/**
 * A bill that holds as much money as it asks for (or more) and has nothing
 * left to pay — every dish voided after a part payment. record_payment refuses
 * a payment of 0, so without this the bill sits `partial` and holds its table.
 *
 * Two ways out: keep the money (it becomes tip, the bill closes, the table
 * frees) or refund it, after which the bill is void and the Cancel card
 * finishes the job. Refund needs `payment.refund`; the server enforces both.
 */
export function CoveredBillCard({
  billId,
  currency,
  heldCents,
  canRefund,
}: {
  billId: string
  currency: string
  heldCents: number
  canRefund: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  function act(fn: () => Promise<{ error: string } | { ok: true } | undefined>, done: () => void) {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (res && "error" in res) {
        setError(res.error)
        return
      }
      done()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nothing left to bill</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {money(heldCents, currency)} is already paid on this bill and nothing is owed. Keep it as a
          tip and close the bill, or give it back.
        </p>
        <Button
          className="min-h-11 w-full"
          disabled={pending}
          onClick={() =>
            act(
              () => closeCoveredBill(billId),
              () => {
                toast.success("Bill closed and the table is free.")
                router.push("/pos")
              },
            )
          }
        >
          <CheckIcon />
          Keep {money(heldCents, currency)} as tip &amp; close
        </Button>
        {canRefund ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field className="min-w-40 flex-1">
              <FieldLabel htmlFor="covered-refund-reason">Reason</FieldLabel>
              <Input
                id="covered-refund-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="All items voided"
              />
            </Field>
            <Button
              variant="outline"
              disabled={pending || !reason.trim()}
              onClick={() =>
                act(
                  () => refundBill(billId, heldCents, reason.trim()),
                  () => {
                    toast.success("Refunded. Cancel the order to free the table.")
                    router.refresh()
                  },
                )
              }
            >
              Refund {money(heldCents, currency)}
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
