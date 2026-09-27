"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ReceiptIcon } from "lucide-react"

import { customerHistory, type CustomerBill } from "@/app/(app)/loyalty/actions"
import { formatDateTime, money } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

export type DrawerCustomer = {
  id: string
  name: string | null
  phone: string | null
  points: number
  tier: string
  outstanding_cents: number
  unpaid_bills: number
}

/**
 * One customer, opened from the CRM list. Answers the two questions a credit
 * checkout leaves behind: what does this person owe, and what have they had
 * before. Unpaid bills link straight to the checkout so the debt can be
 * collected without hunting through Completed.
 */
export function CustomerDrawer({
  customer,
  currency,
  timezone,
  canCollect,
  onOpenChange,
}: {
  customer: DrawerCustomer | null
  currency: string
  timezone: string
  /** payment.take — otherwise the row is read-only. */
  canCollect: boolean
  onOpenChange: (open: boolean) => void
}) {
  // Keyed by customer so a stale list never shows under a new name: the fetch
  // for B lands in `loaded.for = B`, and A's rows are ignored by the derive below.
  const [loaded, setLoaded] = useState<{ for: string; bills?: CustomerBill[]; error?: string } | null>(null)

  useEffect(() => {
    if (!customer) return
    let cancelled = false
    void customerHistory(customer.id).then((res) => {
      if (cancelled) return
      setLoaded("error" in res ? { for: customer.id, error: res.error } : { for: customer.id, bills: res.bills })
    })
    return () => {
      cancelled = true
    }
  }, [customer])

  const current = customer && loaded?.for === customer.id ? loaded : null
  const bills = current?.bills ?? null
  const error = current?.error ?? null
  const unpaid = (bills ?? []).filter((b) => b.outstanding_cents > 0)
  const past = (bills ?? []).filter((b) => b.outstanding_cents === 0)

  return (
    <Sheet open={customer !== null} onOpenChange={onOpenChange}>
      <SheetContent size="md" className="w-full gap-0 overflow-y-auto">
        {customer ? (
          <>
            <SheetHeader>
              <SheetTitle>{customer.name ?? "Guest"}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                {customer.phone ? <span className="tabular-nums">{customer.phone}</span> : null}
                <Badge variant="outline" className="capitalize">
                  {customer.tier} · {customer.points} pts
                </Badge>
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-6">
              <div
                className={
                  customer.outstanding_cents > 0
                    ? "rounded-lg border border-destructive/30 bg-destructive/5 p-3"
                    : "rounded-lg border p-3"
                }
              >
                <p className="text-xs text-muted-foreground">Outstanding credit</p>
                <p
                  className={
                    customer.outstanding_cents > 0
                      ? "text-2xl font-semibold tabular-nums text-destructive"
                      : "text-2xl font-semibold tabular-nums"
                  }
                >
                  {money(customer.outstanding_cents, currency)}
                </p>
                {customer.unpaid_bills > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    across {customer.unpaid_bills} unpaid {customer.unpaid_bills === 1 ? "bill" : "bills"}
                  </p>
                ) : null}
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {bills === null && !error ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : null}

              {bills && unpaid.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Unpaid bills</h3>
                  <ul className="space-y-2">
                    {unpaid.map((b) => (
                      <BillRow key={b.bill_id} b={b} currency={currency} timezone={timezone} canCollect={canCollect} />
                    ))}
                  </ul>
                </section>
              ) : null}

              {bills ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Past orders</h3>
                  {past.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No paid bills yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {past.map((b) => (
                        <BillRow key={b.bill_id} b={b} currency={currency} timezone={timezone} canCollect={false} />
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function BillRow({
  b,
  currency,
  timezone,
  canCollect,
}: {
  b: CustomerBill
  currency: string
  timezone: string
  canCollect: boolean
}) {
  const owes = b.outstanding_cents > 0
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{formatDateTime(b.created_at, timezone)}</span>
          {b.table_label ? <span>· Table {b.table_label}</span> : null}
        </div>
        {b.items_summary ? <p className="truncate">{b.items_summary}</p> : null}
        <div className="flex flex-wrap items-center gap-x-2 tabular-nums">
          <span>{money(b.total_cents, currency)}</span>
          {owes ? (
            <span className="text-destructive">
              · owes {money(b.outstanding_cents, currency)}
              {b.paid_cents > 0 ? ` (paid ${money(b.paid_cents, currency)})` : ""}
            </span>
          ) : (
            <span className="text-muted-foreground">· paid</span>
          )}
        </div>
      </div>
      {owes && canCollect ? (
        <Button size="sm" variant="secondary" render={<Link href={`/bill/${b.bill_id}`} />}>
          <ReceiptIcon className="size-4" />
          Collect
        </Button>
      ) : null}
    </li>
  )
}
