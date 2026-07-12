"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { applyDiscount, payByCard, refundBill, takePayment, voidLine } from "@/app/(app)/bill/actions"
import { money } from "@/lib/format"
import { BillSplit } from "@/components/bill-split"
import { useOffline } from "@/components/offline-sync-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

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

export function BillView({
  currency,
  bill,
  items,
  payments,
  paidCents,
  canDiscount = false,
}: {
  currency: string
  bill: Bill
  items: Item[]
  payments: Payment[]
  paidCents: number
  canDiscount?: boolean
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

  const Row = ({ label, cents, bold }: { label: string; cents: number; bold?: boolean }) => (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span>{money(cents, currency)}</span>
    </div>
  )

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Bill · {bill.restaurant_tables?.label ? `Table ${bill.restaurant_tables.label}` : "Takeaway"}
          </h1>
          <span
            className={`text-sm font-medium capitalize ${
              settled ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
            }`}
          >
            {bill.status}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href={`/receipt/${bill.id}`} />}>
            Receipt
          </Button>
          <Button variant="ghost" nativeButton={false} render={<Link href="/pos" />}>
            ← POS
          </Button>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <ul className="mb-3 space-y-1 text-sm">
          {items.map((it) => (
            <li key={it.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex-1">
                  {it.qty}× {it.description}
                </span>
                <span className="text-muted-foreground">{money(it.total_cents, currency)}</span>
                {canDiscount && !settled && it.order_item_id ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setVoidingId(voidingId === it.id ? null : it.id)}
                    className="text-xs text-destructive hover:underline"
                  >
                    void
                  </button>
                ) : null}
              </div>
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
        <div className="space-y-1 border-t pt-3 text-sm">
          <Row label="Subtotal" cents={bill.subtotal_cents} />
          {bill.service_charge_cents > 0 ? (
            <Row label="Service + packaging" cents={bill.service_charge_cents} />
          ) : null}
          {bill.tax_cents > 0 ? <Row label="Tax" cents={bill.tax_cents} /> : null}
          {bill.discount_cents > 0 ? (
            <Row label="Discount" cents={-bill.discount_cents} />
          ) : null}
          <div className="border-t pt-2">
            <Row label="Total" cents={bill.total_cents} bold />
          </div>
          {paidCents > 0 ? <Row label="Paid" cents={paidCents} /> : null}
          {!settled ? <Row label="Due" cents={due} bold /> : null}
        </div>
      </div>

      {payments.length > 0 ? (
        <div className="mt-4 text-sm text-muted-foreground">
          {payments.map((p) => (
            <div key={p.id} className="flex justify-between">
              <span className="capitalize">{p.method}</span>
              <span>{money(p.amount_cents, currency)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {canDiscount && !settled ? (
        <div className="mt-6 rounded-lg border border-dashed p-3">
          <p className="mb-2 text-sm font-medium">Discount (manager)</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={discType}
              onChange={(e) => setDiscType(e.target.value as "percent" | "flat")}
              className="border-input dark:bg-input/30 h-9 rounded-md border bg-transparent px-2 text-sm"
            >
              <option value="percent">%</option>
              <option value="flat">Flat</option>
            </select>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={discValue}
              onChange={(e) => setDiscValue(e.target.value)}
              placeholder={discType === "percent" ? "10" : "5.00"}
              className="max-w-24"
            />
            <Input
              value={discReason}
              onChange={(e) => setDiscReason(e.target.value)}
              placeholder="Reason"
              className="max-w-40"
            />
            <Button size="sm" variant="secondary" disabled={pending} onClick={discount}>
              Apply
            </Button>
          </div>
        </div>
      ) : null}

      {!settled ? (
        <div className="mt-6 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Amount</span>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="max-w-32"
            />
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={pending} onClick={() => pay("cash")}>
              {pending ? "…" : "Cash"}
            </Button>
            <Button className="flex-1" variant="secondary" disabled={pending} onClick={() => pay("card")}>
              {pending ? "…" : "Card"}
            </Button>
            <Button className="flex-1" variant="outline" disabled={pending} onClick={payOnline}>
              {pending ? "…" : "Card (online)"}
            </Button>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
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
        <div className="mt-6 space-y-3">
          <p className="text-center font-medium text-green-600 dark:text-green-400">
            Paid in full · order closed
          </p>
          {canDiscount ? (
            <div className="rounded-lg border border-dashed p-3">
              <p className="mb-2 text-sm font-medium">Refund (manager)</p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  placeholder={(bill.total_cents / 100).toFixed(2)}
                  className="max-w-24"
                />
                <Input
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Reason"
                  className="max-w-40"
                />
                <Button size="sm" variant="destructive" disabled={pending} onClick={doRefund}>
                  Refund
                </Button>
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
