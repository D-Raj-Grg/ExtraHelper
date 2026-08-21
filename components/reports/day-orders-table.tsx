"use client"

import { useState } from "react"
import Link from "next/link"
import { ReceiptTextIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
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
import {
  BILL_STATUS_STYLE,
  ORDER_STATUS_STYLE,
  billStatusLabel,
  orderStatusLabel,
  orderTypeLabel,
} from "@/lib/order-constants"
import { cn } from "@/lib/utils"
import type { DayOrder } from "./day-orders"

/**
 * An order's own non-void lines.
 *
 * Never `bills.total_cents` — `add_order_to_bill` merges tables, so one bill's
 * total appears on every order sharing it and summing the column would double
 * count. Same rule the POS Completed tab follows.
 */
export function lineTotal(o: DayOrder): number {
  return (o.order_items ?? [])
    .filter((l) => !l.is_void)
    .reduce((sum, l) => sum + l.unit_price_cents * l.qty, 0)
}

export function lineCount(o: DayOrder): number {
  return (o.order_items ?? []).filter((l) => !l.is_void).reduce((sum, l) => sum + l.qty, 0)
}

export function destination(o: DayOrder): string {
  return o.restaurant_tables?.label
    ? `Table ${o.restaurant_tables.label}`
    : orderTypeLabel(o.order_type)
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase()
}

/**
 * The day's orders, each row opening its own detail.
 *
 * A whole row is the target rather than a link on the order number: on the
 * sheet the question is "what was that one?", and making the reader hunt for a
 * six-character id to click is the wrong size of target for a manager checking
 * a day at a counter. The row carries the button role, tab stop and Enter/Space
 * handling itself, and holds no nested link — the bill link lives in the sheet,
 * where it is a deliberate second step rather than a thing to hit by accident.
 *
 * The detail comes from the row already in memory, so opening is instant and
 * costs no round trip; the page's select is what decides how much is there.
 */
export function DayOrdersTable({
  orders,
  currency,
  timezone,
}: {
  orders: DayOrder[]
  currency: string
  timezone: string
}) {
  // Held by id, not by the object: the row is derived from the live list, so a
  // revalidated order shows its new state instead of a frozen snapshot.
  const [openId, setOpenId] = useState<string | null>(null)
  const open = orders.find((o) => o.id === openId) ?? null

  return (
    <>
      <Table className="w-full text-sm">
        <TableHeader className="bg-muted/50">
          <TableRow>
            {/* "Started", not "Closed": created_at is the only timestamp an
                order carries, and labelling it otherwise would be a lie. */}
            <TableHead className="px-3 py-2 font-medium">Started</TableHead>
            <TableHead className="px-3 py-2 font-medium">Order</TableHead>
            <TableHead className="px-3 py-2 font-medium">Destination</TableHead>
            <TableHead className="hidden px-3 py-2 text-right font-medium md:table-cell">
              Items
            </TableHead>
            <TableHead className="px-3 py-2 text-right font-medium">Amount</TableHead>
            <TableHead className="px-3 py-2 font-medium">Status</TableHead>
            <TableHead className="hidden px-3 py-2 font-medium md:table-cell">Bill</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => {
            const cancelled = o.status === "cancelled"
            return (
              <TableRow
                key={o.id}
                role="button"
                tabIndex={0}
                aria-label={`Order ${shortId(o.id)}, ${destination(o)}, ${money(
                  lineTotal(o),
                  currency,
                )}. Open details`}
                onClick={() => setOpenId(o.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    setOpenId(o.id)
                  }
                }}
                className="cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring print:cursor-auto"
              >
                <TableCell className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                  {formatDateTime(o.created_at, timezone)}
                </TableCell>
                <TableCell className="px-3 py-3 font-medium">#{shortId(o.id)}</TableCell>
                <TableCell className="px-3 py-3">
                  {destination(o)}
                  {o.guests ? (
                    <span className="text-muted-foreground"> · {o.guests} guests</span>
                  ) : null}
                </TableCell>
                <TableCell className="hidden px-3 py-3 text-right tabular-nums text-muted-foreground md:table-cell">
                  {lineCount(o)}
                </TableCell>
                <TableCell
                  className={cn(
                    "px-3 py-3 text-right tabular-nums",
                    cancelled && "text-muted-foreground line-through",
                  )}
                >
                  {money(lineTotal(o), currency)}
                </TableCell>
                <TableCell className="px-3 py-3">
                  <Badge
                    className={ORDER_STATUS_STYLE[o.status] ?? "bg-muted text-muted-foreground"}
                  >
                    {orderStatusLabel(o.status)}
                  </Badge>
                </TableCell>
                <TableCell className="hidden px-3 py-3 md:table-cell">
                  {o.bills ? (
                    <Badge
                      className={
                        BILL_STATUS_STYLE[o.bills.status] ?? "bg-muted text-muted-foreground"
                      }
                    >
                      {billStatusLabel(o.bills.status)}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <Sheet open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent size="md" className="flex flex-col gap-0 p-0">
          {open ? <OrderDetail o={open} currency={currency} timezone={timezone} /> : null}
        </SheetContent>
      </Sheet>
    </>
  )
}

function OrderDetail({
  o,
  currency,
  timezone,
}: {
  o: DayOrder
  currency: string
  timezone: string
}) {
  const lines = o.order_items ?? []
  const live = lines.filter((l) => !l.is_void)
  const voided = lines.filter((l) => l.is_void)

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          #{shortId(o.id)}
          <Badge className={ORDER_STATUS_STYLE[o.status] ?? "bg-muted text-muted-foreground"}>
            {orderStatusLabel(o.status)}
          </Badge>
          {o.bills ? (
            <Badge
              className={BILL_STATUS_STYLE[o.bills.status] ?? "bg-muted text-muted-foreground"}
            >
              {billStatusLabel(o.bills.status)}
            </Badge>
          ) : null}
        </SheetTitle>
        <SheetDescription>
          {destination(o)}
          {o.guests ? ` · ${o.guests} guests` : ""} · started{" "}
          {formatDateTime(o.created_at, timezone)}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {live.length === 0 && voided.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This order has no lines. It was opened and left empty.
          </p>
        ) : (
          <dl className="space-y-3">
            {live.map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-3 text-sm">
                <dt className="min-w-0">
                  <span className="font-medium">
                    {l.qty} × {l.name_snapshot}
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {money(l.unit_price_cents, currency)} each
                  </span>
                  {l.notes ? (
                    <span className="block text-xs text-muted-foreground">{l.notes}</span>
                  ) : null}
                </dt>
                <dd className="shrink-0 tabular-nums">
                  {money(l.unit_price_cents * l.qty, currency)}
                </dd>
              </div>
            ))}

            {voided.length > 0 ? (
              <div className="space-y-3 border-t pt-3">
                {/* Voids are shown, not hidden: "why is this order 300 short?"
                    is exactly the question this sheet exists to answer. */}
                <p className="text-xs font-medium text-muted-foreground">Voided</p>
                {voided.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-start justify-between gap-3 text-sm text-muted-foreground"
                  >
                    <dt className="min-w-0 line-through">
                      {l.qty} × {l.name_snapshot}
                    </dt>
                    <dd className="shrink-0 tabular-nums line-through">
                      {money(l.unit_price_cents * l.qty, currency)}
                    </dd>
                  </div>
                ))}
              </div>
            ) : null}
          </dl>
        )}
      </div>

      <div className="border-t px-4 py-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">Ordered</span>
          <span className="text-lg font-semibold tabular-nums">
            {money(lineTotal(o), currency)}
          </span>
        </div>
        {/* The bill is a different number from this one — it carries tax,
            service and any discount, and on a merged table it covers other
            orders too. Naming both stops the sheet reading as a contradiction. */}
        {o.bills ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Its bill totals {money(o.bills.total_cents, currency)} — that includes tax, service and
            discounts, and covers every order sharing the bill.
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">No bill was raised for this order.</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {o.bill_id ? (
            <Link
              href={`/bill/${o.bill_id}`}
              className={cn(buttonVariants({ variant: "default", size: "sm" }))}
            >
              <ReceiptTextIcon className="size-4" />
              Open bill
            </Link>
          ) : null}
          <Link
            href={`/pos/${o.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            View on POS
          </Link>
        </div>
      </div>
    </>
  )
}
