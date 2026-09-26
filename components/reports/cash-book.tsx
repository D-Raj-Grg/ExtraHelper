"use client"

import { useActionState, useState } from "react"
import { CheckCircle2Icon } from "lucide-react"
import { toast } from "sonner"

import { closeDay, type ExpenseState } from "@/app/(app)/expenses/actions"
import { variance } from "@/components/cash/variance"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { formatDateTime, money } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { DayCashBook } from "./day-report"

function signed(cents: number, currency: string) {
  return `${cents > 0 ? "+" : ""}${money(cents, currency)}`
}

/**
 * The paper daily book's last line — "cash left 100, online 1000" — against
 * what the system says should be there. Works with the drawer off; with it on,
 * the per-shift drawer table above still does the shift-level reconciliation.
 */
export function CashBook({
  day,
  book,
  currency,
  timezone,
}: {
  day: string
  book: DayCashBook
  currency: string
  timezone: string
}) {
  const [editing, setEditing] = useState(!book.closed)
  const [state, action, pending] = useActionState<ExpenseState, FormData>(
    async (prev, formData) => {
      const result = await closeDay(prev, formData)
      if (result && "ok" in result) {
        toast.success("Day closed")
        setEditing(false)
      }
      return result
    },
    undefined,
  )

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Cash book</CardTitle>
          <CardDescription>
            {book.closed && book.closed_at
              ? `Counted by ${book.closed_by ?? "someone"} · ${formatDateTime(book.closed_at, timezone)}`
              : "At night, count the cash in hand and check online received, then save."}
          </CardDescription>
        </div>
        {book.closed && !editing ? (
          <Button variant="outline" className="h-11 print:hidden" onClick={() => setEditing(true)}>
            Recount
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <Ledger
          title="Cash"
          sales={book.cash_sales_cents}
          refunds={book.cash_refunds_cents}
          expenses={book.cash_expenses_cents}
          expected={book.expected_cash_cents}
          counted={book.counted_cash_cents}
          diff={book.cash_variance_cents}
          currency={currency}
        />
        <Ledger
          title="Online"
          sales={book.online_sales_cents}
          refunds={book.online_refunds_cents}
          expenses={book.online_expenses_cents}
          expected={book.expected_online_cents}
          counted={book.counted_online_cents}
          diff={book.online_variance_cents}
          currency={currency}
        />

        {editing ? (
          <form action={action} className="flex flex-col gap-4 md:col-span-2 print:hidden">
            <input type="hidden" name="day" value={day} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="cb-cash">Cash in hand ({currency})</FieldLabel>
                <Input
                  id="cb-cash"
                  name="cash"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  required
                  defaultValue={
                    book.counted_cash_cents !== null ? String(book.counted_cash_cents / 100) : ""
                  }
                  className="h-12 text-lg tabular-nums"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="cb-online">Online received ({currency})</FieldLabel>
                <Input
                  id="cb-online"
                  name="online"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="Optional"
                  defaultValue={
                    book.counted_online_cents !== null
                      ? String(book.counted_online_cents / 100)
                      : ""
                  }
                  className="h-12 text-lg tabular-nums"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="cb-note">Note</FieldLabel>
              <Input
                id="cb-note"
                name="note"
                maxLength={280}
                defaultValue={book.note ?? ""}
                placeholder="Rs 500 handed to owner"
                className="h-11"
              />
            </Field>
            {state && "error" in state ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" className="h-11" disabled={pending}>
                <CheckCircle2Icon className="size-4" />
                {pending ? "Saving…" : book.closed ? "Save recount" : "Close the day"}
              </Button>
              {book.closed ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        ) : book.note ? (
          <p className="text-sm text-muted-foreground md:col-span-2">Note: {book.note}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Ledger({
  title,
  sales,
  refunds,
  expenses,
  expected,
  counted,
  diff,
  currency,
}: {
  title: string
  sales: number
  refunds: number
  expenses: number
  expected: number
  counted: number | null
  diff: number | null
  currency: string
}) {
  const v = diff !== null ? variance(diff) : null
  return (
    <dl className="space-y-1 text-sm">
      <div className="mb-2 font-semibold">{title}</div>
      <Row label="Taken in sales" value={money(sales, currency)} />
      {refunds > 0 ? <Row label="Refunded" value={`−${money(refunds, currency)}`} /> : null}
      <Row label="Expenses paid" value={expenses > 0 ? `−${money(expenses, currency)}` : "—"} />
      <Row label="Should have" value={money(expected, currency)} strong />
      <Row label="Counted" value={counted !== null ? money(counted, currency) : "Not counted"} />
      {v && diff !== null ? (
        <div className={cn("flex justify-between gap-4 font-medium", v.tone)}>
          <dt>{v.label}</dt>
          <dd className="tabular-nums">{signed(diff, currency)}</dd>
        </div>
      ) : null}
    </dl>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4", strong && "border-t pt-1 font-semibold")}>
      <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
