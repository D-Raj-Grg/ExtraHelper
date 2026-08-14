"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeftIcon, ReceiptIcon } from "lucide-react"

import {
  addCharge,
  addOrderToBill,
  applyCoupon,
  applyDiscount,
  removeDiscount,
  removeItemDiscount,
  applyItemDiscount,
  attachCustomer,
  payByCard,
  refundBill,
  removeCharge,
  setBillExtras,
  setComplimentary,
  takePayment,
  voidLine,
} from "@/app/(app)/bill/actions"
import { money } from "@/lib/format"
import { billStatusLabel, orderStatusLabel, BILL_STATUS_STYLE, ORDER_STATUS_STYLE } from "@/lib/order-constants"
import { cn } from "@/lib/utils"
import { useOffline } from "@/components/offline-sync-provider"
import { usePrint } from "@/components/print/use-print"
import { PageHeader } from "@/components/page-header"
import { CheckoutCustomerPanel } from "@/components/checkout/customer-panel"
import { CheckoutInvoicePreview } from "@/components/checkout/invoice-preview"
import { CheckoutItemsTable, type DiscountUnit } from "@/components/checkout/items-table"
import { CheckoutPaymentPanel } from "@/components/checkout/payment-panel"
import { CheckoutTotalsPanel } from "@/components/checkout/totals-panel"
import { RefundPanel } from "@/components/checkout/refund-panel"
import type {
  CheckoutBill,
  CheckoutCharge,
  CheckoutCustomer,
  CheckoutItem,
  CheckoutPayment,
  InvoiceMeta,
  MergeableOrder,
  PayMethod,
  PayMode,
} from "@/components/checkout/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** Fresh idempotency key. Module scope — reads Date.now/Math.random. */
function newKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

/**
 * Checkout — one screen that settles a table.
 *
 * Lines and levers on the left, what will print on the right. Every number
 * shown comes from the server's own recompute: this component never adds a
 * total up itself, it only decides what to render and which gated action to
 * fire. Tender/change is the single exception, and it is display-only.
 */
export function CheckoutView({
  currency,
  bill,
  items,
  payments,
  charges,
  paidCents,
  meta,
  canDiscount = false,
  hasStaffDiscount = false,
  customer = null,
  pointsValueCents = 1,
  mergeableOrders = [],
}: {
  currency: string
  bill: CheckoutBill
  items: CheckoutItem[]
  payments: CheckoutPayment[]
  charges: CheckoutCharge[]
  paidCents: number
  meta: InvoiceMeta
  canDiscount?: boolean
  hasStaffDiscount?: boolean
  customer?: CheckoutCustomer | null
  pointsValueCents?: number
  mergeableOrders?: MergeableOrder[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { online, enqueuePayment } = useOffline()
  const { printBill } = usePrint()

  const settled = bill.status === "paid"
  const due = Math.max(0, bill.total_cents - paidCents)

  // Nothing is locked by printing — a table that orders another round after
  // asking for the bill is normal. What is not normal is charging a guest a
  // total they never saw, so the screen says so and offers the reprint.
  const printedStale =
    bill.bill_printed_at !== null && bill.bill_printed_total_cents !== bill.total_cents

  const [mode, setMode] = useState<PayMode>("paid")
  const [method, setMethod] = useState<PayMethod>("cash")
  const [unit, setUnit] = useState<DiscountUnit>("flat")
  const [amount, setAmount] = useState((due / 100).toFixed(2))
  const [note, setNote] = useState(bill.note ?? "")

  // Re-sync the amount when the due moves (discount, charge, part payment).
  const [lastDue, setLastDue] = useState(due)
  if (due !== lastDue) {
    setLastDue(due)
    setAmount((due / 100).toFixed(2))
  }
  // …and the remark when another terminal edits it.
  const [lastNote, setLastNote] = useState(bill.note ?? "")
  if ((bill.note ?? "") !== lastNote) {
    setLastNote(bill.note ?? "")
    setNote(bill.note ?? "")
  }

  // Stable idempotency key per amount, so a timed-out payment the cashier
  // retries can't be recorded twice. New amount → new key.
  const payKey = useRef<{ key: string; cents: number } | null>(null)
  const keyFor = (cents: number) => {
    if (!payKey.current || payKey.current.cents !== cents) {
      payKey.current = { key: newKey(), cents }
    }
    return payKey.current.key
  }
  // Synchronous re-entrancy guard — `pending` only flips on the next render.
  const inFlight = useRef(false)

  /** Run a server action, surfacing its error. One shape for every lever here. */
  function run(fn: () => Promise<{ error: string } | { ok: true } | undefined>) {
    if (inFlight.current) return
    inFlight.current = true
    setError(null)
    startTransition(async () => {
      try {
        const res = await fn()
        if (res && "error" in res) setError(res.error)
      } finally {
        inFlight.current = false
      }
    })
  }

  const destination = bill.restaurant_tables?.label
    ? `Table ${bill.restaurant_tables.label}`
    : "Takeaway"

  function payAmountCents(): number | null {
    const cents = mode === "paid" ? due : Math.round(Number(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      setError("Enter a valid amount.")
      return null
    }
    return cents
  }

  /**
   * Take `cents` by the selected method. Returns the action's own result so the
   * confirm flow can stop on an error, or `queued` when it went to the offline
   * queue instead of the server.
   */
  async function collect(cents: number): Promise<{ error: string } | { ok: true } | "queued"> {
    if (method === "online") {
      if (!online)
        return {
          error: "Card (online) needs a connection. Use cash, or reconnect.",
        }
      const res = await payByCard(bill.id, cents)
      return res ?? { ok: true }
    }

    const payload = {
      billId: bill.id,
      method,
      amountCents: cents,
      label: destination,
    }
    // Decide from live connectivity — the `online` state can lag the event.
    const offlineNow = typeof navigator !== "undefined" ? !navigator.onLine : !online
    const key = keyFor(cents)
    if (offlineNow) {
      await enqueuePayment(payload, key)
      payKey.current = null
      return "queued"
    }
    try {
      const res = await takePayment(bill.id, method, cents, key)
      if (res && "error" in res) return res
      payKey.current = null
      return { ok: true }
    } catch {
      // Maybe committed, maybe not — queue with the SAME key so replay dedups.
      await enqueuePayment(payload, key)
      payKey.current = null
      return "queued"
    }
  }

  /** Tip / round-off / remark all land in one gated call. */
  function saveExtras(tipCents: number, roundingCents: number, nextNote = note) {
    run(() => setBillExtras(bill.id, tipCents, roundingCents, nextNote))
  }

  /**
   * Send the estimate to paper, before a rupee moves.
   *
   * This is the step the screen used to skip: the guest reads the slip, checks
   * it, and only then hands over cash or a card. `enqueue_print_job` stamps
   * `bill_printed_total_cents` as it queues, which is what lets the reprint
   * warning below know the paper has gone stale — so this refreshes afterwards
   * rather than trusting the local copy.
   *
   * A reprint carries no idempotency key on purpose: asking for a second copy
   * is the entire point, and the key the settled receipt uses is the same
   * `bill:<id>:<printer>` string, so deduping here would eat that receipt.
   */
  function presentBill() {
    run(async () => {
      const outcome = await printBill(bill.id)
      if (outcome === "queued") toast.success("Bill sent to the printer.")
      router.refresh()
      return { ok: true }
    })
  }

  /** Finish: settle (or leave on credit), then leave the screen. */
  function confirm(alsoPrint: boolean) {
    if (mode === "credit") {
      if (!customer) {
        setError("Attach a customer before leaving this bill unpaid.")
        return
      }
      toast.success(`${destination} left unpaid on ${customer.name ?? "the customer"}'s tab.`)
      if (alsoPrint) void printBill(bill.id)
      router.push("/pos")
      return
    }

    if (settled) {
      run(async () => {
        if (alsoPrint) await printBill(bill.id)
        router.push("/pos")
        return { ok: true }
      })
      return
    }

    const cents = payAmountCents()
    if (cents === null) return

    run(async () => {
      const res = await collect(cents)
      if (res !== "queued" && "error" in res) return res
      if (res === "queued") {
        toast.success(`${destination} payment queued — it'll send when you're back online.`)
      }
      if (alsoPrint) await printBill(bill.id)
      // A part payment leaves work on this bill, so the cashier stays put.
      if (cents >= due) router.push("/pos")
      return { ok: true }
    })
  }

  const confirmLabel = settled
    ? "Back to POS"
    : mode === "credit"
      ? "Confirm on credit"
      : mode === "partial"
        ? "Confirm part payment"
        : "Confirm checkout"

  return (
    <div>
      <PageHeader
        title={`Checkout · ${destination}`}
        description={
          settled
            ? "Settled. Print or email the receipt."
            : "Adjust the lines, take payment, and confirm — the preview is what prints."
        }
        actions={
          <>
            <Badge
              className={cn(
                "border-transparent",
                BILL_STATUS_STYLE[bill.status] ?? "bg-muted text-foreground",
              )}
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

      {error ? (
        <p
          className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <CheckoutItemsTable
                items={items}
                currency={currency}
                unit={unit}
                onUnitChange={setUnit}
                canDiscount={canDiscount}
                settled={settled}
                disabled={pending}
                onRemoveDiscount={(orderItemId) =>
                  run(() => removeItemDiscount(orderItemId, bill.id))
                }
                onDiscount={(orderItemId, u, value) =>
                  run(() =>
                    applyItemDiscount(
                      orderItemId,
                      bill.id,
                      u === "percent" ? "percent" : "flat",
                      value,
                      "",
                    ),
                  )
                }
                onVoid={(orderItemId, reason) => run(() => voidLine(orderItemId, bill.id, reason))}
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Check-in details</CardTitle>
              </CardHeader>
              <CardContent>
                <CheckoutCustomerPanel
                  customer={customer}
                  currency={currency}
                  pointsValueCents={pointsValueCents}
                  note={note}
                  onNoteChange={setNote}
                  onNoteCommit={() => {
                    if (settled || note === (bill.note ?? "")) return
                    saveExtras(bill.tip_cents, bill.rounding_cents, note)
                  }}
                  onAttach={(name, phone) => run(() => attachCustomer(bill.id, name, phone))}
                  servedBy={meta.waiterName}
                  settled={settled}
                  disabled={pending}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Totals</CardTitle>
              </CardHeader>
              <CardContent>
                <CheckoutTotalsPanel
                  bill={bill}
                  currency={currency}
                  charges={charges}
                  itemTotalCents={items.reduce((n, it) => n + it.total_cents, 0)}
                  canDiscount={canDiscount}
                  hasStaffDiscount={hasStaffDiscount}
                  settled={settled}
                  disabled={pending}
                  onBillDiscount={(type, value, reason) =>
                    run(() => applyDiscount(bill.id, type, value, reason))
                  }
                  onRemoveDiscount={() => run(() => removeDiscount(bill.id))}
                  onCoupon={(code) => run(() => applyCoupon(bill.id, code))}
                  onAddCharge={(label, cents) => run(() => addCharge(bill.id, label, cents))}
                  onRemoveCharge={(id) => run(() => removeCharge(id, bill.id))}
                  onExtras={(tipCents, roundingCents) => saveExtras(tipCents, roundingCents)}
                  onComplimentary={(reason) => run(() => setComplimentary(bill.id, reason))}
                />
              </CardContent>
            </Card>
          </div>

          {!settled ? (
            <Card>
              <CardHeader>
                <CardTitle>Payment</CardTitle>
              </CardHeader>
              <CardContent>
                <CheckoutPaymentPanel
                  billId={bill.id}
                  currency={currency}
                  due={due}
                  totalCents={bill.total_cents}
                  amount={amount}
                  onAmountChange={setAmount}
                  mode={mode}
                  onModeChange={setMode}
                  method={method}
                  onMethodChange={setMethod}
                  items={items}
                  customer={customer}
                  pointsValueCents={pointsValueCents}
                  online={online}
                  pending={pending}
                />
              </CardContent>
            </Card>
          ) : canDiscount ? (
            <Card>
              <CardHeader>
                <CardTitle>Refund</CardTitle>
              </CardHeader>
              <CardContent>
                <RefundPanel
                  currency={currency}
                  totalCents={bill.total_cents}
                  pending={pending}
                  onRefund={(cents, reason) => run(() => refundBill(bill.id, cents, reason))}
                />
              </CardContent>
            </Card>
          ) : null}

          {!settled && mergeableOrders.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Merge another order</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  Combines both tabs into this one total.
                </p>
                {mergeableOrders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      {o.restaurant_tables?.label
                        ? `Table ${o.restaurant_tables.label}`
                        : o.order_type}
                      <Badge
                        className={cn(
                          "border-transparent",
                          ORDER_STATUS_STYLE[o.status] ?? "bg-muted text-foreground",
                        )}
                      >
                        {orderStatusLabel(o.status)}
                      </Badge>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => run(() => addOrderToBill(bill.id, o.id))}
                    >
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
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="lg:sticky lg:top-6">
          <CheckoutInvoicePreview
            bill={bill}
            items={items}
            charges={charges}
            payments={payments}
            paidCents={paidCents}
            customer={customer}
            currency={currency}
            meta={meta}
            settled={settled}
            pending={pending}
            canConfirm={settled || items.length > 0}
            confirmLabel={confirmLabel}
            printedBefore={bill.bill_printed_at !== null}
            printedStale={printedStale}
            onConfirm={() => confirm(false)}
            onConfirmAndPrint={() => confirm(true)}
            onPrintBill={presentBill}
          />
          {!settled && due !== bill.total_cents ? (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {money(paidCents, currency)} already paid on this bill.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
