"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import {
  ArrowLeftIcon,
  BanknoteIcon,
  CheckCircle2Icon,
  CreditCardIcon,
  GlobeIcon,
  ReceiptIcon,
  WifiOffIcon,
} from "lucide-react"
import {
  addOrderToBill,
  applyCoupon,
  applyDiscount,
  applyItemDiscount,
  payByCard,
  refundBill,
  takePayment,
  voidLine,
} from "@/app/(app)/bill/actions"
import { money } from "@/lib/format"
import {
  billStatusLabel,
  orderStatusLabel,
  BILL_STATUS_STYLE,
  ORDER_STATUS_STYLE,
} from "@/lib/order-constants"
import { cn } from "@/lib/utils"
import { BillSplit } from "@/components/bill-split"
import { BillLoyalty } from "@/components/bill-loyalty"
import { useOffline } from "@/components/offline-sync-provider"
import { PageHeader } from "@/components/page-header"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Bill = {
  id: string
  status: string
  subtotal_cents: number
  tax_cents: number
  service_charge_cents: number
  discount_cents: number
  total_cents: number
  restaurant_tables: { label: string } | null
}
type Item = {
  id: string
  order_item_id: string | null
  description: string
  qty: number
  unit_price_cents: number
  total_cents: number
}
type Payment = { id: string; method: string; amount_cents: number }

/** One money line in the totals block. Module scope — see CLAUDE.md. */
function Row({
  label,
  cents,
  currency,
  bold,
}: {
  label: string
  cents: number
  currency: string
  bold?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={bold ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span className={cn("tabular-nums", bold && "font-semibold")}>{money(cents, currency)}</span>
    </div>
  )
}

type MergeableOrder = {
  id: string
  order_type: string
  status: string
  restaurant_tables: { label: string } | null
}

export function BillView({
  currency,
  bill,
  items,
  payments,
  paidCents,
  canDiscount = false,
  customer = null,
  pointsValueCents = 1,
  mergeableOrders = [],
}: {
  currency: string
  bill: Bill
  items: Item[]
  payments: Payment[]
  paidCents: number
  canDiscount?: boolean
  customer?: { id: string; name: string | null; phone: string | null; points: number } | null
  pointsValueCents?: number
  mergeableOrders?: MergeableOrder[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { online, enqueuePayment } = useOffline()
  // Stable idempotency key per (amount) so a timed-out cash payment that the
  // cashier retries can't record twice. New amount → new key.
  const payKey = useRef<{ key: string; cents: number } | null>(null)
  const keyFor = (cents: number) => {
    if (!payKey.current || payKey.current.cents !== cents) {
      payKey.current = {
        key:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
        cents,
      }
    }
    return payKey.current.key
  }
  const due = Math.max(0, bill.total_cents - paidCents)
  const [amount, setAmount] = useState<string>((due / 100).toFixed(2))
  // Re-sync the payment amount when the due changes (e.g. after a discount).
  const [lastDue, setLastDue] = useState(due)
  if (due !== lastDue) {
    setLastDue(due)
    setAmount((due / 100).toFixed(2))
  }
  const [discType, setDiscType] = useState<"percent" | "flat">("percent")
  const [discValue, setDiscValue] = useState<string>("")
  const [discReason, setDiscReason] = useState<string>("")
  const [voidingId, setVoidingId] = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState<string>("")
  const [discItemId, setDiscItemId] = useState<string | null>(null)
  const [itemDiscType, setItemDiscType] = useState<"percent" | "flat">("percent")
  const [itemDiscValue, setItemDiscValue] = useState<string>("")
  const [couponCode, setCouponCode] = useState<string>("")
  const [refundAmount, setRefundAmount] = useState<string>("")
  const [refundReason, setRefundReason] = useState<string>("")
  const settled = bill.status === "paid"

  function doVoid(orderItemId: string) {
    if (!voidReason.trim()) {
      setError("Void reason required.")
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await voidLine(orderItemId, bill.id, voidReason)
      if (res && "error" in res) setError(res.error)
      else {
        setVoidingId(null)
        setVoidReason("")
      }
    })
  }

  function doRefund() {
    const cents = Math.round(Number(refundAmount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      setError("Enter a valid refund amount.")
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await refundBill(bill.id, cents, refundReason)
      if (res && "error" in res) setError(res.error)
      else setRefundAmount("")
    })
  }

  function discount() {
    const v = Number(discValue)
    if (!Number.isFinite(v) || v <= 0) {
      setError("Enter a valid discount.")
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await applyDiscount(bill.id, discType, v, discReason)
      if (res && "error" in res) setError(res.error)
      else setDiscValue("")
    })
  }

  function doItemDiscount(orderItemId: string) {
    const v = Number(itemDiscValue)
    if (!Number.isFinite(v) || v <= 0) {
      setError("Enter a valid discount.")
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await applyItemDiscount(orderItemId, bill.id, itemDiscType, v, "")
      if (res && "error" in res) setError(res.error)
      else {
        setDiscItemId(null)
        setItemDiscValue("")
      }
    })
  }

  function mergeOrder(orderId: string) {
    setError(null)
    startTransition(async () => {
      const res = await addOrderToBill(bill.id, orderId)
      if (res && "error" in res) setError(res.error)
    })
  }

  function coupon() {
    if (!couponCode.trim()) {
      setError("Enter a coupon code.")
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await applyCoupon(bill.id, couponCode)
      if (res && "error" in res) setError(res.error)
      else setCouponCode("")
    })
  }

  function pay(method: "cash" | "card") {
    const cents = Math.round(Number(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      setError("Enter a valid amount.")
      return
    }
    setError(null)
    const label = bill.restaurant_tables?.label
      ? `Table ${bill.restaurant_tables.label}`
      : "Takeaway"
    const payload = { billId: bill.id, method, amountCents: cents, label }

    // Offline → queue (idempotency key travels with it, replays on reconnect).
    const offlineNow = typeof navigator !== "undefined" ? !navigator.onLine : !online
    if (offlineNow) {
      void enqueuePayment(payload)
      return
    }
    const key = keyFor(cents)
    startTransition(async () => {
      try {
        const res = await takePayment(bill.id, method, cents, key)
        if (res && "error" in res) setError(res.error)
        else payKey.current = null
      } catch {
        // Network failure → queue with the SAME key so replay dedups (no double
        // charge if it actually committed).
        await enqueuePayment(payload, key)
        payKey.current = null
      }
    })
  }

  function payOnline() {
    const cents = Math.round(Number(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      setError("Enter a valid amount.")
      return
    }
    if (!online) {
      setError("Card payment needs a connection. Use cash, or reconnect.")
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await payByCard(bill.id, cents)
      if (res && "error" in res) setError(res.error)
    })
  }

  const destination = bill.restaurant_tables?.label
    ? `Table ${bill.restaurant_tables.label}`
    : "Takeaway"

  return (
    <div>
      <PageHeader
        title={`Bill · ${destination}`}
        description={
          settled ? "Settled. Print or email the receipt." : "Take payment, or adjust the bill first."
        }
        actions={
          <>
            <Badge
              className={cn("border-transparent", BILL_STATUS_STYLE[bill.status] ?? "bg-muted")}
            >
              {billStatusLabel(bill.status)}
            </Badge>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`/receipt/${bill.id}`} />}
            >
              <ReceiptIcon className="size-4" /> Receipt
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/pos" />}>
              <ArrowLeftIcon className="size-4" /> POS
            </Button>
          </>
        }
      />

      <div className="rounded-xl border bg-card p-4">
        <ul className="mb-3 flex flex-col gap-2 text-sm">
          {items.map((it) => (
            <li key={it.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1">
                  <span className="tabular-nums">{it.qty}×</span> {it.description}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {money(it.total_cents, currency)}
                </span>
                {canDiscount && !settled && it.order_item_id ? (
                  <span className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      aria-expanded={discItemId === it.id}
                      onClick={() => setDiscItemId(discItemId === it.id ? null : it.id)}
                    >
                      Discount
                      <span className="sr-only"> {it.description}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      aria-expanded={voidingId === it.id}
                      onClick={() => setVoidingId(voidingId === it.id ? null : it.id)}
                      className="text-destructive"
                    >
                      Void
                      <span className="sr-only"> {it.description}</span>
                    </Button>
                  </span>
                ) : null}
              </div>
              {discItemId === it.id && it.order_item_id ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Select
                    value={itemDiscType}
                    onValueChange={(v) => setItemDiscType(v as "percent" | "flat")}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">%</SelectItem>
                      <SelectItem value="flat">Flat</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={itemDiscValue}
                    onChange={(e) => setItemDiscValue(e.target.value)}
                    placeholder={itemDiscType === "percent" ? "10" : "2.00"}
                    className="h-8 max-w-20 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => doItemDiscount(it.order_item_id as string)}
                  >
                    Apply
                  </Button>
                </div>
              ) : null}
              {voidingId === it.id && it.order_item_id ? (
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="Void reason"
                    className="h-8 max-w-40 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => doVoid(it.order_item_id as string)}
                  >
                    Confirm void
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-1 border-t pt-3 text-sm">
          <Row currency={currency} label="Subtotal" cents={bill.subtotal_cents} />
          {bill.service_charge_cents > 0 ? (
            <Row currency={currency} label="Service + packaging" cents={bill.service_charge_cents} />
          ) : null}
          {bill.tax_cents > 0 ? <Row currency={currency} label="Tax" cents={bill.tax_cents} /> : null}
          {bill.discount_cents > 0 ? (
            <Row currency={currency} label="Discount" cents={-bill.discount_cents} />
          ) : null}
          <div className="border-t pt-2">
            <Row currency={currency} label="Total" cents={bill.total_cents} bold />
          </div>
          {paidCents > 0 ? <Row currency={currency} label="Paid" cents={paidCents} /> : null}
          {/* Due is the number the cashier acts on — it gets the weight. */}
          {!settled ? (
            <div className="mt-1 flex items-baseline justify-between gap-4 border-t pt-2">
              <span className="font-semibold">Due</span>
              <span className="text-2xl font-bold tabular-nums">{money(due, currency)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {payments.length > 0 ? (
        <div className="mt-4 flex flex-col gap-1 text-sm">
          {payments.map((p) => (
            <div key={p.id} className="flex justify-between gap-4">
              <span className="capitalize text-muted-foreground">{p.method}</span>
              <span className="tabular-nums">{money(p.amount_cents, currency)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {!settled ? (
        <div className="mt-6 rounded-xl border p-4">
          <div className="flex flex-wrap items-end gap-2">
            <Field className="max-w-40">
              <FieldLabel htmlFor="coupon-code">Coupon</FieldLabel>
              <Input
                id="coupon-code"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="CODE"
                className="uppercase"
              />
            </Field>
            <Button variant="secondary" disabled={pending} onClick={coupon}>
              Apply coupon
            </Button>
          </div>
        </div>
      ) : null}

      {!settled && mergeableOrders.length > 0 ? (
        <div className="mt-6 rounded-xl border p-4">
          <p className="text-sm font-semibold">Merge another order onto this bill</p>
          <p className="mb-3 text-sm text-muted-foreground">
            Combines both tabs into this one total.
          </p>
          <div className="flex flex-col gap-2">
            {mergeableOrders.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  {o.restaurant_tables?.label ? `Table ${o.restaurant_tables.label}` : o.order_type}
                  <Badge
                    className={cn(
                      "border-transparent",
                      ORDER_STATUS_STYLE[o.status] ?? "bg-muted",
                    )}
                  >
                    {orderStatusLabel(o.status)}
                  </Badge>
                </span>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => mergeOrder(o.id)}>
                  Add to bill
                  <span className="sr-only">
                    {" "}
                    from{" "}
                    {o.restaurant_tables?.label
                      ? `Table ${o.restaurant_tables.label}`
                      : o.order_type}
                  </span>
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {canDiscount && !settled ? (
        <div className="mt-6 rounded-xl border p-4">
          <p className="text-sm font-semibold">Discount the whole bill</p>
          <p className="mb-3 text-sm text-muted-foreground">
            Manager only. Recorded against your account with the reason.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field className="w-32">
              <FieldLabel htmlFor="disc-type">Type</FieldLabel>
              <Select
                value={discType}
                onValueChange={(v) => setDiscType(v as "percent" | "flat")}
              >
                <SelectTrigger id="disc-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent</SelectItem>
                  <SelectItem value="flat">Flat amount</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field className="w-24">
              <FieldLabel htmlFor="disc-value">
                {discType === "percent" ? "Percent" : currency}
              </FieldLabel>
              <Input
                id="disc-value"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={discValue}
                onChange={(e) => setDiscValue(e.target.value)}
                placeholder={discType === "percent" ? "10" : "5.00"}
                className="tabular-nums"
              />
            </Field>
            <Field className="min-w-40 flex-1">
              <FieldLabel htmlFor="disc-reason">Reason</FieldLabel>
              <Input
                id="disc-reason"
                value={discReason}
                onChange={(e) => setDiscReason(e.target.value)}
                placeholder="Why this discount applies"
              />
            </Field>
            <Button variant="secondary" disabled={pending} onClick={discount}>
              Apply
            </Button>
          </div>
        </div>
      ) : null}

      {!settled ? (
        <div className="mt-6 flex flex-col gap-3">
          <div className="rounded-xl border bg-card p-4">
            <Field className="mb-3 max-w-40">
              <FieldLabel htmlFor="pay-amount">Amount ({currency})</FieldLabel>
              <Input
                id="pay-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-12 text-lg font-semibold tabular-nums"
              />
            </Field>
            <div className="grid gap-2 sm:grid-cols-3">
              <Button className="h-12 text-base" disabled={pending} onClick={() => pay("cash")}>
                <BanknoteIcon className="size-4" />
                {pending ? "Taking…" : "Cash"}
              </Button>
              <Button
                className="h-12 text-base"
                variant="secondary"
                disabled={pending}
                onClick={() => pay("card")}
              >
                <CreditCardIcon className="size-4" />
                {pending ? "Taking…" : "Card"}
              </Button>
              <Button
                className="h-12 text-base"
                variant="outline"
                disabled={pending || !online}
                onClick={payOnline}
                title={online ? undefined : "Card (online) needs a connection"}
              >
                <GlobeIcon className="size-4" />
                {pending ? "Taking…" : "Card (online)"}
              </Button>
            </div>
            {!online ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <WifiOffIcon className="size-3.5 shrink-0" />
                Offline — cash and card queue and sync on reconnect. Card (online) needs a
                connection.
              </p>
            ) : null}
            {error ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <BillLoyalty
            billId={bill.id}
            currency={currency}
            due={due}
            pointsValueCents={pointsValueCents}
            customer={customer}
          />
          <BillSplit
            billId={bill.id}
            currency={currency}
            due={due}
            totalCents={bill.total_cents}
            items={items}
            disabled={pending}
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          <p className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2Icon className="size-4 shrink-0" />
            Paid in full · order closed
          </p>
          <Button
            className="h-12 text-base"
            nativeButton={false}
            render={<Link href={`/receipt/${bill.id}`} />}
          >
            <ReceiptIcon className="size-4" /> Print or email the receipt
          </Button>

          {canDiscount ? (
            <div className="rounded-xl border p-4">
              <p className="text-sm font-semibold">Refund</p>
              <p className="mb-3 text-sm text-muted-foreground">
                Manager only. Refunds are audited against your account.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <Field className="w-28">
                  <FieldLabel htmlFor="refund-amount">Amount ({currency})</FieldLabel>
                  <Input
                    id="refund-amount"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    placeholder={(bill.total_cents / 100).toFixed(2)}
                    className="tabular-nums"
                  />
                </Field>
                <Field className="min-w-40 flex-1">
                  <FieldLabel htmlFor="refund-reason">Reason</FieldLabel>
                  <Input
                    id="refund-reason"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="Why this is being refunded"
                  />
                </Field>
                <RefundButton
                  currency={currency}
                  amount={refundAmount}
                  reason={refundReason}
                  pending={pending}
                  onConfirm={doRefund}
                />
              </div>
              {error ? (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

/**
 * Refunds move real money out and can't be undone, so they confirm and state
 * the amount back. Previously a single click on a small red button.
 */
function RefundButton({
  currency,
  amount,
  reason,
  pending,
  onConfirm,
}: {
  currency: string
  amount: string
  reason: string
  pending: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)
  const cents = Math.round(Number(amount) * 100)
  const valid = Number.isFinite(cents) && cents > 0 && reason.trim().length > 0

  return (
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
            This returns {money(cents || 0, currency)} to the customer and is recorded against your
            account with the reason “{reason.trim()}”. It can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            Refund {money(cents || 0, currency)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
