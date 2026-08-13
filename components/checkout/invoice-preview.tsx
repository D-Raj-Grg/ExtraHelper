"use client"

import { CheckCircle2Icon, PrinterIcon } from "lucide-react"

import { amountInWords, formatDateTime, money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import type {
  CheckoutBill,
  CheckoutCharge,
  CheckoutCustomer,
  CheckoutItem,
  CheckoutPayment,
  InvoiceMeta,
} from "@/components/checkout/types"

/** Same dish at the same rate collapses to one particular, like the printed bill. */
function groupParticulars(items: CheckoutItem[]) {
  const by = new Map<string, { key: string; name: string; rate: number; qty: number; amount: number }>()
  for (const it of items) {
    const key = `${it.description}|${it.unit_price_cents}`
    const row = by.get(key)
    if (row) {
      row.qty += it.qty
      row.amount += it.total_cents
    } else {
      by.set(key, {
        key,
        name: it.description,
        rate: it.unit_price_cents,
        qty: it.qty,
        amount: it.total_cents,
      })
    }
  }
  return [...by.values()]
}

/**
 * What will print, rendered live as the cashier works.
 *
 * It reads only from props — no second money calculation lives here. If this
 * and the thermal receipt ever disagree, the bug is upstream in recompute_bill,
 * not in two competing formulas.
 */
export function CheckoutInvoicePreview({
  bill,
  items,
  charges,
  payments,
  paidCents,
  customer,
  currency,
  meta,
  settled,
  pending,
  canConfirm,
  confirmLabel,
  onConfirm,
  onConfirmAndPrint,
}: {
  bill: CheckoutBill
  items: CheckoutItem[]
  charges: CheckoutCharge[]
  payments: CheckoutPayment[]
  paidCents: number
  customer: CheckoutCustomer | null
  currency: string
  meta: InvoiceMeta
  settled: boolean
  pending: boolean
  canConfirm: boolean
  confirmLabel: string
  onConfirm: () => void
  onConfirmAndPrint: () => void
}) {
  const rows = groupParticulars(items)
  const due = Math.max(0, bill.total_cents - paidCents)
  const destination = bill.restaurant_tables?.label
    ? `Dine in: Table ${bill.restaurant_tables.label}`
    : "Takeaway"

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border bg-card p-4 text-sm">
        {meta.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meta.logoUrl}
            alt=""
            className="mx-auto mb-2 max-h-14 w-auto max-w-full object-contain"
          />
        ) : null}
        <p className="text-center text-base font-bold uppercase tracking-wide">
          {settled ? "Tax invoice" : "Estimate invoice"}
        </p>
        <p className="text-center text-xs text-muted-foreground">{meta.tenantName}</p>

        <div className="mt-3 flex justify-between gap-2 text-xs">
          <span>
            Invoice no:{" "}
            <span className="font-medium tabular-nums">{bill.id.slice(0, 8).toUpperCase()}</span>
          </span>
          <span className="tabular-nums">{formatDateTime(bill.created_at, meta.timezone)}</span>
        </div>
        <p className="mt-1 text-xs">{destination}</p>
        <p className="text-xs">
          Customer: <span className="font-medium">{customer?.name ?? "Walk-in"}</span>
        </p>

        <table className="mt-3 w-full border-t pt-2 text-xs">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-1 text-left font-medium">Particular</th>
              <th className="py-1 text-right font-medium">Rate</th>
              <th className="py-1 text-right font-medium">Qty</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-0.5">{r.name}</td>
                <td className="py-0.5 text-right tabular-nums">{money(r.rate, currency)}</td>
                <td className="py-0.5 text-right tabular-nums">{r.qty}</td>
                <td className="py-0.5 text-right tabular-nums">{money(r.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-3 space-y-0.5 border-t pt-2 text-xs">
          <Line label="Sub total" value={money(bill.subtotal_cents, currency)} />
          {bill.service_charge_cents > 0 ? (
            <Line
              label="Service + packaging"
              value={money(bill.service_charge_cents, currency)}
            />
          ) : null}
          {bill.tax_cents > 0 ? <Line label="Tax" value={money(bill.tax_cents, currency)} /> : null}
          {charges.map((c) => (
            <Line key={c.id} label={c.label} value={money(c.amount_cents, currency)} />
          ))}
          {bill.discount_cents > 0 ? (
            <Line label="Discount" value={`− ${money(bill.discount_cents, currency)}`} />
          ) : null}
          {bill.tip_cents > 0 ? <Line label="Tip" value={money(bill.tip_cents, currency)} /> : null}
          {bill.rounding_cents !== 0 ? (
            <Line label="Round off" value={money(bill.rounding_cents, currency)} />
          ) : null}
          <div className="border-t pt-1">
            <Line label="Total amount" value={money(bill.total_cents, currency)} strong />
          </div>
        </dl>

        <p className="mt-2 text-xs italic text-muted-foreground">
          {amountInWords(bill.total_cents, currency)}
        </p>

        {payments.length > 0 ? (
          <dl className="mt-2 space-y-0.5 border-t pt-2 text-xs">
            {payments.map((p) => (
              <Line
                key={p.id}
                label={`Paid · ${p.method}`}
                value={money(p.amount_cents, currency)}
              />
            ))}
            {due > 0 ? <Line label="Balance due" value={money(due, currency)} strong /> : null}
          </dl>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Payment mode: <span className="font-medium">Unpaid ({money(due, currency)})</span>
          </p>
        )}

        {bill.note ? <p className="mt-2 border-t pt-2 text-xs">{bill.note}</p> : null}

        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          <p>Billed by: {meta.billedBy}</p>
          {meta.waiterName ? <p>Served by: {meta.waiterName}</p> : null}
          {meta.serviceMinutes !== null ? (
            <p>Service duration: {formatDuration(meta.serviceMinutes)}</p>
          ) : null}
        </div>

        {!settled ? (
          <p className="mt-3 text-center text-xs font-semibold">
            This is not a tax invoice — the final bill comes from the counter.
          </p>
        ) : null}
        {meta.qrUrl ? (
          <div className="mt-3 text-center">
            {meta.qrCaption ? <p className="mb-1 text-xs font-semibold">{meta.qrCaption}</p> : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={meta.qrUrl}
              alt={meta.qrCaption || "Payment QR code"}
              className="mx-auto aspect-square w-40 max-w-full object-contain"
            />
          </div>
        ) : null}
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {meta.footer ?? "Thank you — please visit again."}
        </p>
        {meta.terms ? (
          <p className="mt-1 text-center text-[11px] text-muted-foreground">{meta.terms}</p>
        ) : null}
      </div>

      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">
          {settled ? "Settled" : due < bill.total_cents ? "Balance due" : "Net amount"}
        </p>
        <p className="text-2xl font-bold tabular-nums">
          {money(settled ? bill.total_cents : due, currency)}
        </p>
        {settled ? (
          <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
            Paid in full · order closed
          </p>
        ) : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Button
            variant="outline"
            className="h-12"
            disabled={pending || !canConfirm}
            onClick={onConfirmAndPrint}
          >
            <PrinterIcon className="size-4" />
            {settled ? "Print receipt" : "Confirm & print"}
          </Button>
          <Button className="h-12" disabled={pending || !canConfirm} onClick={onConfirm}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** One label/value pair on the preview. Module scope — see CLAUDE.md. */
function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

/** "2 hrs 4 mins" — how long the table was open. */
function formatDuration(minutes: number): string {
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  const parts: string[] = []
  if (d > 0) parts.push(`${d} day${d > 1 ? "s" : ""}`)
  if (h > 0) parts.push(`${h} hr${h > 1 ? "s" : ""}`)
  if (m > 0 || parts.length === 0) parts.push(`${m} min${m === 1 ? "" : "s"}`)
  return parts.join(" ")
}
