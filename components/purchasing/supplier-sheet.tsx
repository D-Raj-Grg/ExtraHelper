"use client"

import { useActionState } from "react"
import { updateSupplier, type PurchState } from "@/app/(app)/purchasing/actions"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
import { OutstandingCell, PO_STATUS, type Supplier, type SupplierBalance } from "./types"

export type DetailOrder = {
  id: string
  status: string
  created_at: string
  po_items: { qty_ordered: number; qty_received: number; unit_cost_cents: number }[]
}
export type DetailPayment = {
  id: string
  amount_cents: number
  method: string
  paid_at: string
  note: string | null
  voided_at: string | null
}

/**
 * The whole supplier record, plus their orders and payments.
 *
 * A sheet rather than a fourth tab: this is the detail of a row, and a nested
 * tab set inside a tab would be a second way to do the same thing.
 */
export function SupplierSheet({
  supplier,
  balance,
  orders,
  payments,
  loading,
  currency,
  timezone,
  onOpenChange,
}: {
  supplier: Supplier | null
  balance: SupplierBalance | undefined
  /** Fetched by the list on the open event — see the note in orders-tab. */
  orders: DetailOrder[]
  payments: DetailPayment[]
  loading: boolean
  currency: string
  timezone: string
  onOpenChange: (open: boolean) => void
}) {
  const [state, action, pending] = useActionState<PurchState, FormData>(updateSupplier, undefined)

  if (!supplier) return <Sheet open={false} onOpenChange={onOpenChange} />

  const out = Number(balance?.outstanding_cents ?? 0)

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent size="lg" className="w-full gap-0">
        <SheetHeader>
          <SheetTitle>{supplier.name}</SheetTitle>
          <SheetDescription>
            Everything you&apos;ve ordered from them and everything you&apos;ve paid.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border p-4 text-sm">
            <span className="tabular-nums text-muted-foreground">
              Received {money(Number(balance?.received_cents ?? 0), currency)}
            </span>
            <span className="tabular-nums text-muted-foreground">
              Paid {money(Number(balance?.paid_cents ?? 0), currency)}
            </span>
            <span className="tabular-nums">
              <OutstandingCell cents={out} money={money(Math.abs(out), currency)} />
            </span>
          </div>

          {/* contact and email have existed in the schema since day one with no
              input anywhere — this is the first place either can be set. */}
          <form action={action} className="flex flex-col gap-4">
            <input type="hidden" name="supplierId" value={supplier.id} />
            <Field>
              <FieldLabel htmlFor="sup-name">Name</FieldLabel>
              <Input id="sup-name" name="name" defaultValue={supplier.name} required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="sup-contact">Contact person</FieldLabel>
                <Input id="sup-contact" name="contact" defaultValue={supplier.contact ?? ""} />
              </Field>
              <Field>
                <FieldLabel htmlFor="sup-phone">Phone</FieldLabel>
                <Input id="sup-phone" name="phone" defaultValue={supplier.phone ?? ""} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="sup-email">Email</FieldLabel>
              <Input id="sup-email" name="email" type="email" defaultValue={supplier.email ?? ""} />
            </Field>
            {state && "error" in state ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}
            {state && "ok" in state ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
                Saved.
              </p>
            ) : null}
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save details"}
              </Button>
            </div>
          </form>

          <section>
            <h3 className="mb-2 text-sm font-medium">Purchase orders</h3>
            {loading && orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing ordered from {supplier.name} yet.
              </p>
            ) : (
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead>Raised</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Received value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="py-1 whitespace-nowrap">
                        {formatDateTime(o.created_at, timezone)}
                      </TableCell>
                      <TableCell className="py-1 text-muted-foreground">
                        {PO_STATUS[o.status]?.label ?? o.status}
                      </TableCell>
                      <TableCell className="py-1 text-right tabular-nums">
                        {money(
                          o.po_items.reduce(
                            (s, l) => s + Number(l.qty_received) * Number(l.unit_cost_cents),
                            0,
                          ),
                          currency,
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium">Payments</h3>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing recorded as paid to {supplier.name} yet.
              </p>
            ) : (
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead>Paid</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="py-1 whitespace-nowrap">
                        {formatDateTime(p.paid_at, timezone)}
                      </TableCell>
                      <TableCell className="py-1 text-muted-foreground">
                        {paymentMethodLabel(p.method)}
                      </TableCell>
                      <TableCell className="py-1 text-right tabular-nums">
                        {p.voided_at ? (
                          <span className="text-muted-foreground line-through">
                            {money(p.amount_cents, currency)}
                          </span>
                        ) : (
                          money(p.amount_cents, currency)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
