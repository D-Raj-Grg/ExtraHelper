"use client"

import { useState } from "react"
import { GiftIcon, PlusIcon, TicketIcon, XIcon } from "lucide-react"

import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { CheckoutBill, CheckoutCharge } from "@/components/checkout/types"

/** One money line. Module scope — see CLAUDE.md. */
function Row({
  label,
  cents,
  currency,
  strong,
  muted,
  action,
}: {
  label: string
  cents: number
  currency: string
  strong?: boolean
  muted?: boolean
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span
        className={cn(
          "flex items-center gap-1.5 text-sm",
          strong ? "font-semibold" : muted ? "text-muted-foreground" : undefined,
        )}
      >
        {label}
        {action}
      </span>
      <span className={cn("tabular-nums", strong ? "text-lg font-bold" : "text-sm")}>
        {money(cents, currency)}
      </span>
    </div>
  )
}

/**
 * The money column: what the bill adds up to, and every lever that changes it.
 *
 * Nothing here computes the total — every control fires a gated RPC and the
 * server's recompute comes back as props. The panel only decides what to show.
 */
export function CheckoutTotalsPanel({
  bill,
  currency,
  charges,
  itemTotalCents,
  canDiscount,
  settled,
  disabled,
  onBillDiscount,
  onCoupon,
  onAddCharge,
  onRemoveCharge,
  onExtras,
  onComplimentary,
}: {
  bill: CheckoutBill
  currency: string
  charges: CheckoutCharge[]
  itemTotalCents: number
  canDiscount: boolean
  settled: boolean
  disabled: boolean
  onBillDiscount: (type: "percent" | "flat", value: number, reason: string) => void
  onCoupon: (code: string) => void
  onAddCharge: (label: string, amountCents: number) => void
  onRemoveCharge: (chargeId: string) => void
  onExtras: (tipCents: number, roundingCents: number) => void
  onComplimentary: (reason: string) => void
}) {
  const [discType, setDiscType] = useState<"percent" | "flat">("percent")
  const [discValue, setDiscValue] = useState("")
  const [discReason, setDiscReason] = useState("")
  const [coupon, setCoupon] = useState("")
  const [chargeLabel, setChargeLabel] = useState("")
  const [chargeAmount, setChargeAmount] = useState("")
  const [tip, setTip] = useState((bill.tip_cents / 100).toFixed(2))
  const [comp, setComp] = useState<string | null>(null)

  // Re-sync the tip field when the server value moves (another terminal, or a
  // recompute) — but only while it isn't being edited into something else.
  const [lastTip, setLastTip] = useState(bill.tip_cents)
  if (bill.tip_cents !== lastTip) {
    setLastTip(bill.tip_cents)
    setTip((bill.tip_cents / 100).toFixed(2))
  }

  const chargesTotal = charges.reduce((n, c) => n + c.amount_cents, 0)
  // Round the total DOWN to the nearest whole currency unit — the usual "make
  // it a round number" the cashier wants. Rounding is capped under one unit
  // server-side, so this is the only shape it can take.
  const roundable = (bill.total_cents - bill.rounding_cents) % 100
  const roundOffCents = roundable === 0 ? 0 : -roundable

  return (
    <div className="flex flex-col">
      <Row label="Item total" cents={itemTotalCents} currency={currency} muted />
      <Row label="Sub total" cents={bill.subtotal_cents} currency={currency} />
      {bill.service_charge_cents > 0 ? (
        <Row
          label="Service + packaging"
          cents={bill.service_charge_cents}
          currency={currency}
          muted
        />
      ) : null}
      {bill.tax_cents > 0 ? (
        <Row label="Tax" cents={bill.tax_cents} currency={currency} muted />
      ) : null}
      {charges.map((c) => (
        <Row
          key={c.id}
          label={c.label}
          cents={c.amount_cents}
          currency={currency}
          muted
          action={
            canDiscount && !settled ? (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                onClick={() => onRemoveCharge(c.id)}
              >
                <XIcon className="size-3.5" />
                <span className="sr-only">Remove {c.label}</span>
              </Button>
            ) : null
          }
        />
      ))}
      {bill.discount_cents > 0 ? (
        <Row label="Discount" cents={-bill.discount_cents} currency={currency} muted />
      ) : null}
      {bill.tip_cents > 0 ? (
        <Row label="Tip" cents={bill.tip_cents} currency={currency} muted />
      ) : null}
      {bill.rounding_cents !== 0 ? (
        <Row label="Round off" cents={bill.rounding_cents} currency={currency} muted />
      ) : null}

      <div className="mt-1 border-t pt-2">
        <Row label="Total" cents={bill.total_cents} currency={currency} strong />
      </div>

      {settled ? null : (
        <div className="mt-4 space-y-3 border-t pt-4">
          {canDiscount ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field className="w-28">
                <FieldLabel htmlFor="bill-disc-type">Discount</FieldLabel>
                <Select
                  value={discType}
                  onValueChange={(v) => setDiscType(v as "percent" | "flat")}
                >
                  <SelectTrigger id="bill-disc-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent</SelectItem>
                    <SelectItem value="flat">{currency}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field className="w-24">
                <FieldLabel htmlFor="bill-disc-value">
                  {discType === "percent" ? "%" : currency}
                </FieldLabel>
                <Input
                  id="bill-disc-value"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  className="tabular-nums"
                  value={discValue}
                  onChange={(e) => setDiscValue(e.target.value)}
                />
              </Field>
              <Field className="min-w-36 flex-1">
                <FieldLabel htmlFor="bill-disc-reason">Reason</FieldLabel>
                <Input
                  id="bill-disc-reason"
                  value={discReason}
                  onChange={(e) => setDiscReason(e.target.value)}
                  placeholder="Why"
                />
              </Field>
              <Button
                variant="secondary"
                disabled={disabled || !(Number(discValue) > 0)}
                onClick={() => {
                  onBillDiscount(discType, Number(discValue), discReason)
                  setDiscValue("")
                  setDiscReason("")
                }}
              >
                Apply
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-2">
            <Field className="w-36">
              <FieldLabel htmlFor="coupon-code">Coupon</FieldLabel>
              <Input
                id="coupon-code"
                className="uppercase"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                placeholder="CODE"
              />
            </Field>
            <Button
              variant="secondary"
              disabled={disabled || !coupon.trim()}
              onClick={() => {
                onCoupon(coupon)
                setCoupon("")
              }}
            >
              <TicketIcon className="size-4" />
              Apply coupon
            </Button>
          </div>

          {canDiscount ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field className="min-w-32 flex-1">
                <FieldLabel htmlFor="charge-label">Extra charge</FieldLabel>
                <Input
                  id="charge-label"
                  value={chargeLabel}
                  onChange={(e) => setChargeLabel(e.target.value)}
                  placeholder="Delivery, packing…"
                />
              </Field>
              <Field className="w-28">
                <FieldLabel htmlFor="charge-amount">{currency}</FieldLabel>
                <Input
                  id="charge-amount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  className="tabular-nums"
                  value={chargeAmount}
                  onChange={(e) => setChargeAmount(e.target.value)}
                />
              </Field>
              <Button
                variant="secondary"
                disabled={disabled || !chargeLabel.trim() || !(Number(chargeAmount) > 0)}
                onClick={() => {
                  onAddCharge(chargeLabel, Math.round(Number(chargeAmount) * 100))
                  setChargeLabel("")
                  setChargeAmount("")
                }}
              >
                <PlusIcon className="size-4" />
                Add
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-2">
            <Field className="w-28">
              <FieldLabel htmlFor="tip-amount">Tip ({currency})</FieldLabel>
              <Input
                id="tip-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="tabular-nums"
                value={tip}
                onChange={(e) => setTip(e.target.value)}
                onBlur={() => onExtras(Math.max(0, Math.round(Number(tip) * 100)), bill.rounding_cents)}
              />
            </Field>
            <Button
              variant="outline"
              disabled={disabled || (roundOffCents === 0 && bill.rounding_cents === 0)}
              onClick={() =>
                onExtras(
                  bill.tip_cents,
                  bill.rounding_cents !== 0 ? 0 : roundOffCents,
                )
              }
            >
              {bill.rounding_cents !== 0
                ? "Undo round off"
                : `Round off ${money(roundOffCents, currency)}`}
            </Button>
            {canDiscount ? (
              <Button
                variant="outline"
                disabled={disabled || bill.total_cents === 0}
                onClick={() => setComp("")}
              >
                <GiftIcon className="size-4" />
                Complimentary
              </Button>
            ) : null}
          </div>
          {chargesTotal > 0 ? (
            <p className="text-xs text-muted-foreground">
              {charges.length} extra charge{charges.length > 1 ? "s" : ""} ·{" "}
              <span className="tabular-nums">{money(chargesTotal, currency)}</span>
            </p>
          ) : null}
        </div>
      )}

      <AlertDialog open={comp !== null} onOpenChange={(o) => !o && setComp(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make this bill complimentary?</AlertDialogTitle>
            <AlertDialogDescription>
              The whole {money(bill.total_cents, currency)} is written off — it counts as a
              discount in reports, not as revenue, and is recorded against your account with this
              reason.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={comp ?? ""}
            onChange={(e) => setComp(e.target.value)}
            placeholder="Reason (required)"
            aria-label="Complimentary reason"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!comp?.trim()}
              onClick={() => {
                if (!comp?.trim()) return
                onComplimentary(comp)
                setComp(null)
              }}
            >
              Comp the bill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
