"use client"

import { useState, useTransition } from "react"
import { CheckCircle2Icon, MailIcon, PrinterIcon } from "lucide-react"
import { emailReceipt, type ReceiptState } from "@/app/receipt/actions"
import { amountInWords, formatDateTime, money } from "@/lib/format"
import { groupParticulars, hasBillAdjustments } from "@/lib/print/docs"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PrintPageSize } from "@/components/print/print-page-size"

type Bill = {
  id: string
  status: string
  subtotal_cents: number
  tax_cents: number
  service_charge_cents: number
  discount_cents: number
  total_cents: number
  created_at: string
  restaurant_tables: { label: string } | null
}
type Item = { id: string; description: string; qty: number; unit_price_cents: number; total_cents: number }
type Payment = { id: string; method: string; amount_cents: number }

/** One printed money line. Module scope — see CLAUDE.md. */
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
    <div className={`flex justify-between ${bold ? "font-bold" : ""}`}>
      <span>{label}</span>
      <span>{money(cents, currency)}</span>
    </div>
  )
}

export function ReceiptView({
  tenantName,
  currency,
  timezone,
  bill,
  items,
  payments,
  footer,
  terms,
  logoUrl,
  qrUrl,
  qrCaption,
  customerName,
  servedBy,
  paperWidthMm = 80,
}: {
  tenantName: string
  currency: string
  timezone: string
  bill: Bill
  items: Item[]
  payments: Payment[]
  footer?: string
  terms?: string
  logoUrl?: string
  qrUrl?: string
  qrCaption?: string
  customerName?: string | null
  servedBy?: string | null
  paperWidthMm?: number
}) {
  const [pending, startTransition] = useTransition()
  const [email, setEmail] = useState("")
  const [state, setState] = useState<ReceiptState>(undefined)

  // Both borrowed from the printed slip's builder rather than reimplemented:
  // grouping decides how many lines a guest counts, and `hasBillAdjustments`
  // decides whether a figure appears at all. Those are the two places this page
  // could silently disagree with the paper it is a copy of.
  const particulars = groupParticulars(
    items.map((it) => ({
      description: it.description,
      qty: it.qty,
      unitPriceCents: it.unit_price_cents,
      totalCents: it.total_cents,
    })),
  )
  const adjusted = hasBillAdjustments({
    serviceChargeCents: bill.service_charge_cents,
    taxCents: bill.tax_cents,
    discountCents: bill.discount_cents,
  })
  const settled = bill.status === "paid"

  function sendEmail() {
    startTransition(async () => {
      setState(await emailReceipt(bill.id, email))
    })
  }

  return (
    <div className="w-full max-w-full" style={{ width: `${paperWidthMm}mm` }}>
      {/* The slip is sized in millimetres, not in a Tailwind max-width: a px
          width is meaningless to a printer, so the browser laid a 320px block
          out on A4 and centred it, leaving a white gutter each side.
          PrintPageSize makes the sheet itself the width of the roll. */}
      <PrintPageSize targetId="receipt-paper" widthMm={paperWidthMm} />

      {/* Printable receipt (thermal-width). 2mm rather than zero: an 80mm roll
          only has ~72mm of printable head travel (see components/print/raster.ts),
          so the dashed rules land where the ESC/POS 48-column divider lands —
          flush, but inside what a head can actually strike. The same padding on
          screen and in print, so the height PrintPageSize measures here is the
          height that prints; a print-only padding made the page 2mm too tall. */}
      <div
        id="receipt-paper"
        className="rounded-lg bg-white p-[2mm] font-mono text-xs text-black shadow-sm print:rounded-none print:shadow-none"
      >
        <div className="mb-2 text-center">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              className="mx-auto mb-1 max-h-16 w-auto max-w-full object-contain"
            />
          ) : null}
          {/* "Invoice", not "Tax invoice" — see the heading note in
              lib/print/docs.ts. All three surfaces say the same word. */}
          <p className="text-sm font-bold uppercase">{settled ? "Invoice" : "Estimate"}</p>
          <p className="text-[11px]">{tenantName}</p>
        </div>

        <div className="space-y-0.5 border-t border-dashed border-neutral-300 pt-2">
          <div className="flex justify-between gap-2">
            <span>Invoice no</span>
            <span>{bill.id.slice(0, 8).toUpperCase()}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Date</span>
            <span>{formatDateTime(bill.created_at, timezone)}</span>
          </div>
          <p>
            {bill.restaurant_tables?.label
              ? `Dine in: Table ${bill.restaurant_tables.label}`
              : "Takeaway"}
          </p>
          {/* Omitted for a walk-in rather than filled in — "Customer: Walk-in"
              tells the guest nothing on most receipts. */}
          {customerName ? <p>Customer: {customerName}</p> : null}
        </div>

        {/* Particular / Rate / Qty / Amount, same four columns as the printed
            slip. A real table with a header row, per the design system. */}
        <table className="mt-2 w-full border-t border-dashed border-neutral-300 pt-2">
          <thead>
            <tr className="border-b border-dashed border-neutral-300">
              <th className="py-0.5 text-left font-bold">Particular</th>
              <th className="py-0.5 text-right font-bold">Rate</th>
              <th className="py-0.5 text-right font-bold">Qty</th>
              <th className="py-0.5 text-right font-bold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {particulars.map((g) => (
              <tr key={`${g.name}|${g.rate}`}>
                <td className="py-0.5 pr-1">{g.name}</td>
                <td className="py-0.5 text-right tabular-nums">{money(g.rate, currency)}</td>
                <td className="py-0.5 text-right tabular-nums">{g.qty}</td>
                <td className="py-0.5 text-right tabular-nums">{money(g.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-2 space-y-0.5 border-t border-dashed border-neutral-300 pt-2">
          {/* Shared with the printed slip so the two can never disagree about
              whether this line exists. */}
          {adjusted ? (
            <Row currency={currency} label="Sub total" cents={bill.subtotal_cents} />
          ) : null}
          {bill.service_charge_cents > 0 ? (
            <Row currency={currency} label="Service + pkg" cents={bill.service_charge_cents} />
          ) : null}
          {bill.tax_cents > 0 ? <Row currency={currency} label="Tax" cents={bill.tax_cents} /> : null}
          {bill.discount_cents > 0 ? <Row currency={currency} label="Discount" cents={-bill.discount_cents} /> : null}
          <div className="border-t border-neutral-400 pt-1">
            <Row currency={currency} label="TOTAL" cents={bill.total_cents} bold />
          </div>
          <p className="text-center text-[10px]">{amountInWords(bill.total_cents, currency)}</p>
        </div>
        {payments.length > 0 ? (
          <div className="mt-2 space-y-0.5 border-t border-dashed border-neutral-300 pt-2">
            {payments.map((p) => (
              <div key={p.id} className="flex justify-between">
                <span className="capitalize">Paid - {p.method}</span>
                <span className="tabular-nums">{money(p.amount_cents, currency)}</span>
              </div>
            ))}
          </div>
        ) : null}
        {servedBy ? (
          <p className="mt-2 border-t border-dashed border-neutral-300 pt-2">
            Served by: {servedBy}
          </p>
        ) : null}
        {qrUrl ? (
          <div className="mt-2 border-t border-dashed border-neutral-300 pt-2 text-center">
            {qrCaption ? <p className="mb-1 text-[10px] font-bold">{qrCaption}</p> : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrUrl}
              alt={qrCaption || "Payment QR code"}
              className="mx-auto aspect-square w-[62%] object-contain"
            />
          </div>
        ) : null}
        <div className="mt-3 border-t border-dashed border-neutral-300 pt-2 text-center text-[10px] text-neutral-600">
          {footer ? <p>{footer}</p> : <p>Thank you!</p>}
          {terms ? <p className="mt-1">{terms}</p> : null}
        </div>
      </div>

      {/* Controls (hidden when printing). The receipt above stays mono/paper —
          only the surrounding UI follows the app's design system. */}
      <div className="mt-4 flex flex-col gap-3 print:hidden">
        <Button className="h-12 w-full text-base" onClick={() => window.print()}>
          <PrinterIcon className="size-4" /> Print receipt
        </Button>

        {/* A real form so Enter sends, and the field is actually labelled. */}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            sendEmail()
          }}
        >
          <Field className="flex-1">
            <FieldLabel htmlFor="receipt-email">Email a copy</FieldLabel>
            <Input
              id="receipt-email"
              type="email"
              placeholder="customer@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={pending || !email.trim()}>
            <MailIcon className="size-4" />
            {pending ? "Sending…" : "Send"}
          </Button>
        </form>

        {state && "error" in state ? (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}
        {state && "ok" in state ? (
          <p
            className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"
            role="status"
          >
            <CheckCircle2Icon className="size-4 shrink-0" />
            Receipt sent to {email}.
          </p>
        ) : null}
      </div>
    </div>
  )
}
