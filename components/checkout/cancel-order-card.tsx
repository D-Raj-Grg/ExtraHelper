"use client"

import { useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Trash2Icon } from "lucide-react"

import { cancelOrder } from "@/app/(app)/pos/actions"
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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/**
 * Cancels one or more billed orders in sequence. The last cancel voids the
 * bill; earlier ones on a shared bill just detach their order. Stops at the
 * first error so the cashier sees what blocked it (e.g. "this bill has
 * payments on it — refund them before cancelling") instead of a half-silent
 * partial run. Server messages pass through verbatim.
 */
export function CancelOrderDialog({
  orderIds,
  open,
  onOpenChange,
  onDone,
}: {
  orderIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const router = useRouter()
  const reasonId = useId()
  const [pending, startTransition] = useTransition()
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const many = orderIds.length > 1

  function cancel() {
    setError(null)
    startTransition(async () => {
      for (const id of orderIds) {
        const res = await cancelOrder(id, reason.trim())
        if (res && "error" in res) {
          setError(res.error)
          toast.error(res.error)
          // Earlier orders may already be gone; refresh so the screen is true.
          router.refresh()
          return
        }
      }
      toast.success(many ? "Orders cancelled and the table is free." : "Order cancelled and the table is free.")
      onOpenChange(false)
      setReason("")
      onDone?.()
      router.push("/pos")
    })
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) {
          setReason("")
          setError(null)
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{many ? "Cancel all orders on this bill?" : "Cancel this order?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {many
              ? `All ${orderIds.length} orders on this bill are cancelled, the bill is voided and the tables are freed.`
              : "The bill is voided and the table is freed."}{" "}
            This is recorded against your name and can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Field className="px-4">
          <FieldLabel htmlFor={reasonId}>Reason</FieldLabel>
          <Input
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="All items voided"
          />
        </Field>
        {error ? (
          <p role="alert" className="px-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            disabled={!reason.trim() || pending}
            className="bg-destructive text-white hover:bg-destructive/90"
            // Keep the dialog open so a refusal stays readable next to the reason.
            onClick={(e) => {
              e.preventDefault()
              cancel()
            }}
          >
            {pending ? "Cancelling…" : many ? "Cancel orders" : "Cancel order"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * The way out of a billed order whose dishes were all voided: the bill sits
 * open at zero, can't be paid, and would otherwise hold the table forever.
 * `cancel_order` voids the bill and frees the table; it refuses (and says why)
 * when money has already landed on the bill.
 */
export function CancelOrderCard({ orderIds }: { orderIds: string[] }) {
  const [open, setOpen] = useState(false)
  const many = orderIds.length > 1

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nothing left to bill</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {many
            ? `Every dish on this bill was voided, so there is nothing to pay. Cancel all ${orderIds.length} orders on this bill to void it and free the tables.`
            : "Every dish on this order was voided, so there is nothing to pay. Cancel the order to void the bill and free the table."}
        </p>
        <Button
          variant="outline"
          className="min-h-11 w-full text-destructive"
          onClick={() => setOpen(true)}
        >
          <Trash2Icon />
          {many ? "Cancel all orders" : "Cancel order"}
        </Button>
      </CardContent>
      <CancelOrderDialog orderIds={orderIds} open={open} onOpenChange={setOpen} />
    </Card>
  )
}
