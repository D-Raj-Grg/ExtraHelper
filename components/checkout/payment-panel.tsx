"use client"

import { useState } from "react"
import { CoinsIcon, SplitIcon, WifiOffIcon } from "lucide-react"

import { money } from "@/lib/format"
import {
  PAYMENT_METHODS,
  PAYMENT_REFERENCE_MAX,
  paymentMethodTakesReference,
} from "@/lib/payment-constants"
import { cn } from "@/lib/utils"
import { BillLoyalty } from "@/components/bill-loyalty"
import { BillSplit } from "@/components/bill-split"
import { ChoiceChip } from "@/components/pos/choice-chip"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type {
  CheckoutCustomer,
  CheckoutItem,
  PayMethod,
  PayMode,
} from "@/components/checkout/types"

/**
 * How the bill gets settled — intent first, amount second.
 *
 * There is no pay button here: the confirm buttons beside the invoice preview
 * are the one place the bill is committed, so the cashier can't take money by
 * one route and confirm by another. This panel only says how much, in what
 * form, and what's owed back.
 */
export function CheckoutPaymentPanel({
  billId,
  currency,
  due,
  totalCents,
  amount,
  onAmountChange,
  mode,
  onModeChange,
  method,
  onMethodChange,
  reference,
  onReferenceChange,
  items,
  customer,
  pointsValueCents,
  online,
  pending,
}: {
  billId: string
  currency: string
  due: number
  totalCents: number
  amount: string
  onAmountChange: (v: string) => void
  mode: PayMode
  onModeChange: (m: PayMode) => void
  method: PayMethod
  onMethodChange: (m: PayMethod) => void
  reference: string
  onReferenceChange: (v: string) => void
  items: CheckoutItem[]
  customer: CheckoutCustomer | null
  pointsValueCents: number
  online: boolean
  pending: boolean
}) {
  const [tender, setTender] = useState("")

  const amountCents = mode === "paid" ? due : Math.round(Number(amount) * 100)
  const tenderCents = Math.round(Number(tender) * 100)
  const change =
    Number.isFinite(tenderCents) && tenderCents > 0 ? tenderCents - Math.max(0, amountCents) : 0

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Payment mode</legend>
        <div className="flex flex-wrap gap-2">
          <ChoiceChip
            name="pay-mode"
            checked={mode === "paid"}
            onSelect={() => onModeChange("paid")}
            label="Paid in full"
            detail={money(due, currency)}
          />
          <ChoiceChip
            name="pay-mode"
            checked={mode === "partial"}
            onSelect={() => onModeChange("partial")}
            label="Partial"
          />
          <ChoiceChip
            name="pay-mode"
            checked={mode === "credit"}
            onSelect={() => onModeChange("credit")}
            label="Unpaid (credit)"
          />
        </div>
      </fieldset>

      {mode === "credit" ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
          Nothing is collected now — the bill stays open as a tab
          {customer ? ` on ${customer.name ?? "this customer"}` : ", so attach a customer first"}.
        </p>
      ) : (
        <>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Method</legend>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((spec) => {
                const Icon = spec.icon
                const unavailable = spec.needsOnline && !online
                return (
                  <ChoiceChip
                    key={spec.value}
                    name="pay-method"
                    checked={method === spec.value}
                    onSelect={() => onMethodChange(spec.value as PayMethod)}
                    disabled={unavailable}
                    leading={<Icon className="size-4 shrink-0" aria-hidden />}
                    label={spec.label}
                    detail={unavailable ? "needs a connection" : undefined}
                  />
                )
              })}
            </div>
          </fieldset>

          {paymentMethodTakesReference(method) ? (
            <Field>
              <FieldLabel htmlFor="pay-reference">Reference (optional)</FieldLabel>
              <Input
                id="pay-reference"
                value={reference}
                maxLength={PAYMENT_REFERENCE_MAX}
                onChange={(e) => onReferenceChange(e.target.value)}
                placeholder="Transaction id from the guest's confirmation"
                className="h-11"
              />
              <p className="text-xs text-muted-foreground">
                Saved on the payment so it reconciles against the provider&apos;s statement.
              </p>
            </Field>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="pay-amount">Amount ({currency})</FieldLabel>
              <Input
                id="pay-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={mode === "paid" ? (due / 100).toFixed(2) : amount}
                disabled={mode === "paid"}
                onChange={(e) => onAmountChange(e.target.value)}
                className="h-12 text-lg font-semibold tabular-nums"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="tender-amount">Tendered ({currency})</FieldLabel>
              <Input
                id="tender-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={tender}
                onChange={(e) => setTender(e.target.value)}
                placeholder="Handed over"
                className="h-12 text-lg font-semibold tabular-nums"
              />
            </Field>
          </div>

          {tender.trim() !== "" && Number.isFinite(tenderCents) ? (
            <div
              className={cn(
                "flex items-baseline justify-between gap-3 rounded-lg border p-3",
                change >= 0
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-amber-500/40 bg-amber-500/5",
              )}
              role="status"
            >
              <span className="text-sm font-semibold">
                {change >= 0 ? "Change due" : "Still short"}
              </span>
              <span
                className={cn(
                  "text-2xl font-bold tabular-nums",
                  change >= 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-amber-700 dark:text-amber-400",
                )}
              >
                {change >= 0 ? "+" : "−"} {money(Math.abs(change), currency)}
              </span>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger
                render={
                  <Button variant="outline" className="h-11">
                    <SplitIcon className="size-4" />
                    Split the check
                  </Button>
                }
              />
              <DialogContent size="lg">
                <DialogHeader>
                  <DialogTitle>Split {money(due, currency)}</DialogTitle>
                </DialogHeader>
                <div className="min-h-0 overflow-y-auto p-4">
                  <BillSplit
                    billId={billId}
                    currency={currency}
                    due={due}
                    totalCents={totalCents}
                    items={items}
                    disabled={pending}
                  />
                </div>
              </DialogContent>
            </Dialog>

            <Dialog>
              <DialogTrigger
                render={
                  <Button variant="outline" className="h-11">
                    <CoinsIcon className="size-4" />
                    Pay with points
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Loyalty points</DialogTitle>
                </DialogHeader>
                <div className="p-4">
                  <BillLoyalty
                    billId={billId}
                    currency={currency}
                    due={due}
                    pointsValueCents={pointsValueCents}
                    customer={customer}
                  />
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {!online ? (
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <WifiOffIcon className="size-3.5 shrink-0" aria-hidden />
              Offline — cash, card, eSewa, FonePay, bank and wallet all queue and sync on
              reconnect. Card (online) needs a connection.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
