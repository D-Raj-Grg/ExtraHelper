"use client"

import { useState, useTransition } from "react"
import { CheckCircle2Icon, MailIcon, PrinterIcon } from "lucide-react"
import { emailReceipt, type ReceiptState } from "@/app/receipt/actions"
import { formatDateTime, money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

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
}: {
  tenantName: string
  currency: string
  timezone: string
  bill: Bill
  items: Item[]
  payments: Payment[]
  footer?: string
  terms?: string
}) {
  const [pending, startTransition] = useTransition()
  const [email, setEmail] = useState("")
  const [state, setState] = useState<ReceiptState>(undefined)

  function sendEmail() {
    startTransition(async () => {
      setState(await emailReceipt(bill.id, email))
    })
  }

  return (
    <div className="w-full max-w-xs">
      {/* Printable receipt (thermal-width). */}
      <div className="rounded-lg bg-white p-4 font-mono text-xs text-black shadow-sm print:rounded-none print:shadow-none">
        <div className="mb-2 text-center">
          <p className="text-sm font-bold uppercase">{tenantName}</p>
          <p className="text-[10px] text-neutral-500">
            {bill.restaurant_tables?.label ? `Table ${bill.restaurant_tables.label}` : "Takeaway"}
            {" · "}
            {formatDateTime(bill.created_at, timezone)}
          </p>
        </div>
        <div className="border-t border-dashed border-neutral-300 pt-2">
          {items.map((it) => (
            <div key={it.id} className="flex justify-between">
              <span>
                {it.qty}× {it.description}
              </span>
              <span>{money(it.total_cents, currency)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 space-y-0.5 border-t border-dashed border-neutral-300 pt-2">
          <Row currency={currency} label="Subtotal" cents={bill.subtotal_cents} />
          {bill.service_charge_cents > 0 ? (
            <Row currency={currency} label="Service + pkg" cents={bill.service_charge_cents} />
          ) : null}
          {bill.tax_cents > 0 ? <Row currency={currency} label="Tax" cents={bill.tax_cents} /> : null}
          {bill.discount_cents > 0 ? <Row currency={currency} label="Discount" cents={-bill.discount_cents} /> : null}
          <div className="border-t border-neutral-400 pt-1">
            <Row currency={currency} label="TOTAL" cents={bill.total_cents} bold />
          </div>
        </div>
        {payments.length > 0 ? (
          <div className="mt-2 space-y-0.5 border-t border-dashed border-neutral-300 pt-2">
            {payments.map((p) => (
              <div key={p.id} className="flex justify-between">
                <span className="capitalize">Paid ({p.method})</span>
                <span>{money(p.amount_cents, currency)}</span>
              </div>
            ))}
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
