"use client"

import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { money } from "@/lib/format"

export type SupplierBalance = {
  supplier_id: string
  supplier_name: string
  received_cents: number
  paid_cents: number
  outstanding_cents: number
}

/**
 * What is owed to each supplier: received value minus payments. Derived, never
 * stored — a stored balance is a second source of truth that drifts away from
 * the rows it claims to summarise.
 *
 * A negative outstanding means paid ahead of what has been received, which is
 * normal for a quick purchase that never went through a purchase order.
 */
export function Payables({
  balances,
  currency,
}: {
  balances: SupplierBalance[]
  currency: string
}) {
  const owed = balances.filter((b) => b.outstanding_cents > 0)
  const totalOwed = owed.reduce((sum, b) => sum + b.outstanding_cents, 0)

  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">What you owe</h2>
      {balances.length === 0 ? (
        <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
          Nothing recorded yet. Record a payment when you settle a delivery, and what is still
          outstanding shows up here.
        </Card>
      ) : (
        <Card className="gap-3 p-4">
          <p className="flex items-center gap-1.5 text-sm">
            {totalOwed > 0 ? (
              <>
                <AlertCircleIcon className="size-4 text-amber-700 dark:text-amber-400" />
                <span className="text-amber-700 dark:text-amber-400">
                  <span className="tabular-nums">{money(totalOwed, currency)}</span> owing across{" "}
                  {owed.length} {owed.length === 1 ? "supplier" : "suppliers"}
                </span>
              </>
            ) : (
              <>
                <CheckCircle2Icon className="size-4 text-emerald-700 dark:text-emerald-400" />
                <span className="text-emerald-700 dark:text-emerald-400">
                  Every supplier settled
                </span>
              </>
            )}
          </p>
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((b) => (
                <TableRow key={b.supplier_id}>
                  <TableCell className="py-1">{b.supplier_name}</TableCell>
                  <TableCell className="py-1 text-right text-muted-foreground tabular-nums">
                    {money(b.received_cents, currency)}
                  </TableCell>
                  <TableCell className="py-1 text-right text-muted-foreground tabular-nums">
                    {money(b.paid_cents, currency)}
                  </TableCell>
                  {/* The word carries the meaning; colour only reinforces it. */}
                  <TableCell className="py-1 text-right tabular-nums">
                    {b.outstanding_cents > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        {money(b.outstanding_cents, currency)} owing
                      </span>
                    ) : b.outstanding_cents < 0 ? (
                      <span className="text-muted-foreground">
                        {money(-b.outstanding_cents, currency)} paid ahead
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Settled</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
  )
}
