"use client"

import { useState } from "react"
import { voidSupplierPayment, type PurchState } from "@/app/(app)/purchasing/actions"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime, money } from "@/lib/format"
import { paymentMethodLabel } from "@/lib/payment-constants"
import { ConfirmButton } from "./confirm-button"
import { PaymentDialog } from "./payment-dialog"
import type { Supplier, SupplierPayment } from "./types"

export function PaymentsTab({
  currency,
  timezone,
  payments,
  suppliers,
  owedCents,
  canDelete,
  run,
}: {
  currency: string
  timezone: string
  payments: SupplierPayment[]
  suppliers: Supplier[]
  owedCents: number
  canDelete: boolean
  run: (fn: () => Promise<PurchState>, ok?: string) => void
}) {
  if (payments.length === 0)
    return (
      <Card className="border-dashed p-8 text-center">
        <p className="font-medium">
          {owedCents > 0
            ? `You owe ${money(owedCents, currency)} and nothing is recorded as paid`
            : "No payments recorded"}
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {owedCents > 0
            ? "Record what you've already handed over, so the balances mean something."
            : "Record a purchase when you pay for something outright, or settle a delivery from the Orders tab."}
        </p>
        <div className="mt-4 self-center">
          <PaymentDialog
            currency={currency}
            suppliers={suppliers}
            triggerLabel="Record a purchase"
          />
        </div>
      </Card>
    )

  return (
    <Card className="overflow-x-auto p-0">
      <Table className="text-sm">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="px-3 py-2">Paid</TableHead>
            <TableHead className="px-3 py-2">Supplier</TableHead>
            <TableHead className="px-3 py-2">For</TableHead>
            <TableHead className="px-3 py-2">Method</TableHead>
            <TableHead className="px-3 py-2 text-right">Amount</TableHead>
            {canDelete ? <TableHead className="px-3 py-2 text-right">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p) => (
            <PaymentRow
              key={p.id}
              payment={p}
              currency={currency}
              timezone={timezone}
              canDelete={canDelete}
              run={run}
            />
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

function PaymentRow({
  payment,
  currency,
  timezone,
  canDelete,
  run,
}: {
  payment: SupplierPayment
  currency: string
  timezone: string
  canDelete: boolean
  run: (fn: () => Promise<PurchState>, ok?: string) => void
}) {
  const [reason, setReason] = useState("")
  const voided = Boolean(payment.voided_at)
  const name = payment.suppliers?.name ?? "Unknown supplier"

  return (
    <TableRow>
      <TableCell className="px-3 py-2 whitespace-nowrap">
        {formatDateTime(payment.paid_at, timezone)}
      </TableCell>
      <TableCell className="px-3 py-2">{name}</TableCell>
      <TableCell className="px-3 py-2 text-muted-foreground">
        {payment.po_id ? "Purchase order" : "Quick purchase"}
        {payment.note ? <span className="block text-xs">{payment.note}</span> : null}
        {/* A voided payment is never hidden — a payment that disappears is
            exactly what makes a reconciliation impossible. */}
        {voided ? (
          <Badge className="mt-1 gap-1 bg-destructive/10 text-destructive">
            Voided{payment.void_reason ? ` · ${payment.void_reason}` : ""}
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="px-3 py-2 text-muted-foreground">
        {paymentMethodLabel(payment.method)}
      </TableCell>
      <TableCell className="px-3 py-2 text-right tabular-nums">
        {voided ? (
          <span className="text-muted-foreground line-through">
            {money(payment.amount_cents, currency)}
          </span>
        ) : (
          money(payment.amount_cents, currency)
        )}
      </TableCell>
      {canDelete ? (
        <TableCell className="px-3 py-2">
          <div className="flex justify-end">
            {voided ? null : (
              <ConfirmButton
                label="Void"
                variant="ghost"
                destructive
                title={`Void the ${money(payment.amount_cents, currency)} paid to ${name}?`}
                confirmLabel="Void payment"
                description={
                  <span className="block space-y-3">
                    <span className="block">
                      It stays in this list marked voided and stops counting toward what
                      you&apos;ve paid. If it came from a drawer that&apos;s still open, the
                      money goes back onto that shift.
                    </span>
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why are you voiding it?"
                      aria-label="Reason for voiding"
                    />
                  </span>
                }
                onConfirm={() =>
                  run(() => voidSupplierPayment(payment.id, reason), "Payment voided.")
                }
              />
            )}
          </div>
        </TableCell>
      ) : null}
    </TableRow>
  )
}
