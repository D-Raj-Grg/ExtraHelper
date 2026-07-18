"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import {
  ArmchairIcon,
  EllipsisVerticalIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptIcon,
  ShoppingBagIcon,
  UsersIcon,
  XCircleIcon,
} from "lucide-react"

import { cancelOrder, listOrderKotIds, pinOrder } from "@/app/(app)/pos/actions"
import { generateBill } from "@/app/(app)/bill/actions"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { orderStatusLabel, orderTypeLabel, ORDER_STATUS_STYLE } from "@/lib/order-constants"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { RelativeTime } from "@/components/pos/relative-time"
import type { PosOrderCard } from "@/components/pos/types"

/** How many lines to show before collapsing the rest into a count. */
const MAX_LINES = 4

/**
 * One active order. Tapping the body opens the order; the action row below it
 * carries the mid-service shortcuts (add, print, checkout) and the ⋯ overflow
 * (pin, print slip, clear) so a waiter rarely needs to open the modal at all.
 */
export function OrderCard({
  order,
  currency,
  timeZone,
  onOpen,
}: {
  order: PosOrderCard
  currency: string
  timeZone: string
  onOpen: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [clearOpen, setClearOpen] = useState(false)
  const [reason, setReason] = useState("")

  const lines = (order.order_items ?? []).filter((l) => !l.is_void)
  const dishes = lines.reduce((sum, l) => sum + l.qty, 0)
  const total = lines.reduce((sum, l) => sum + l.unit_price_cents * l.qty, 0)
  const shown = lines.slice(0, MAX_LINES)
  const rest = lines.length - shown.length

  // "New" means nothing has been fired yet — the only reading that's true.
  // Deriving it from a time window would call a 20-minute-old untouched order
  // stale when it's still waiting on the waiter.
  const isNew = order.status === "draft"
  const isTakeaway = !order.restaurant_tables
  const pinned = !!order.pinned_at
  const label = order.restaurant_tables?.label ? `Table ${order.restaurant_tables.label}` : "Takeaway"

  function printSlip() {
    startTransition(async () => {
      const res = await listOrderKotIds(order.id)
      if ("error" in res) return void toast.error(res.error)
      if (!res.kotIds.length) return void toast.info("Nothing fired to the kitchen yet.")
      res.kotIds.forEach((id) => window.open(`/kot/${id}`, "_blank", "noopener"))
    })
  }

  function togglePin() {
    startTransition(async () => {
      const res = await pinOrder(order.id, !pinned)
      if (res && "error" in res) toast.error(res.error)
    })
  }

  function checkout() {
    // generateBill redirects to /bill/[id] on success, so it only returns here
    // on error (e.g. the order isn't fired yet, so there's nothing to bill).
    startTransition(async () => {
      const res = await generateBill(order.id)
      if (res && "error" in res) toast.error(res.error)
    })
  }

  function clearOrder() {
    startTransition(async () => {
      const res = await cancelOrder(order.id, reason.trim())
      if (res && "error" in res) return void toast.error(res.error)
      toast.success(`${label} order cleared.`)
    })
    setReason("")
    setClearOpen(false)
  }

  return (
    <Card className="group flex flex-col overflow-hidden p-0">
      <div className="relative flex flex-1 flex-col">
        {/*
         * Default view — order details. Click to open. On a pointer device it
         * fades out as the actions overlay fades in (same box, no height change);
         * on touch there's no hover, so this stays and a tap opens the order.
         */}
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${label} order · ${dishes} ${dishes === 1 ? "dish" : "dishes"} · ${money(total, currency)}`}
          className="flex flex-1 flex-col gap-3 p-4 text-left transition-opacity duration-150 ease-out group-hover:opacity-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-base font-semibold">
                {pinned ? (
                  <PinIcon className="size-3.5 shrink-0 fill-current text-blue-700 dark:text-blue-400" aria-hidden />
                ) : null}
                {label}
                {pinned ? <span className="sr-only">(pinned)</span> : null}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {isTakeaway ? (
                  <ShoppingBagIcon className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <ArmchairIcon className="size-3.5 shrink-0" aria-hidden />
                )}
                {orderTypeLabel(order.order_type)}
                {order.guests ? (
                  <>
                    <span aria-hidden>·</span>
                    <UsersIcon className="size-3.5 shrink-0" aria-hidden />
                    <span className="tabular-nums">{order.guests}</span>
                    <span className="sr-only">guests</span>
                  </>
                ) : null}
              </p>
            </div>
            {isNew ? (
              <Badge className="shrink-0 border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                New
              </Badge>
            ) : (
              <Badge className={cn("shrink-0 border-transparent", ORDER_STATUS_STYLE[order.status])}>
                {orderStatusLabel(order.status)}
              </Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            <RelativeTime iso={order.created_at} timeZone={timeZone} />
          </p>

          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dishes yet — tap to add some.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {shown.map((l) => (
                <li key={l.id} className="flex justify-between gap-2">
                  <span className="truncate">{l.name_snapshot}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{l.qty}</span>
                </li>
              ))}
              {rest > 0 ? <li className="text-xs text-muted-foreground">+{rest} more</li> : null}
            </ul>
          )}

          <div className="mt-auto flex items-baseline justify-between gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              {dishes} {dishes === 1 ? "dish" : "dishes"}
            </span>
            <span className="text-base font-bold tabular-nums">{money(total, currency)}</span>
          </div>
        </button>

        {/*
         * Hover/keyboard actions — cross-fades in over the details in the SAME
         * box, so the card never changes height. Hidden on touch (no hover);
         * there the card tap opens the order, whose screen has these actions.
         */}
        <div className="absolute inset-0 flex flex-col bg-card opacity-0 pointer-events-none transition-opacity duration-150 ease-out group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto motion-reduce:transition-none">
          <div className="flex items-start justify-between gap-2 p-4 pb-0">
            <p className="min-w-0 truncate text-base font-semibold">{label}</p>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" className="-mr-2 -mt-2 size-11 shrink-0" aria-label="More order actions" />
                }
              >
                <EllipsisVerticalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={togglePin}>
                  {pinned ? <PinOffIcon /> : <PinIcon />}
                  {pinned ? "Unpin" : "Pin to top"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={printSlip}>
                  <PrinterIcon />
                  Print order slip
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={() => setClearOpen(true)}>
                  <XCircleIcon />
                  Clear order
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center px-4">
            <span className="text-2xl font-bold tabular-nums">{money(total, currency)}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {dishes} {dishes === 1 ? "dish" : "dishes"}
            </span>
          </div>

          <div className="flex flex-col gap-2 p-4 pt-0">
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-11 flex-1"
                disabled={pending}
                onClick={onOpen}
                aria-label="Add items to this order"
              >
                <PlusIcon />
              </Button>
              <Button
                variant="outline"
                className="h-11 flex-1"
                disabled={pending}
                onClick={printSlip}
                aria-label="Print kitchen slip"
              >
                <PrinterIcon />
              </Button>
            </div>
            <Button
              variant="outline"
              className="min-h-11 w-full text-emerald-700 hover:text-emerald-700 dark:text-emerald-400"
              disabled={pending || dishes === 0}
              onClick={checkout}
            >
              <ReceiptIcon />
              Checkout
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog
        open={clearOpen}
        onOpenChange={(o) => {
          setClearOpen(o)
          if (!o) setReason("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear {label} order?</AlertDialogTitle>
            <AlertDialogDescription>
              All {dishes} {dishes === 1 ? "dish" : "dishes"} are voided and the order is cancelled — any
              deducted stock is returned. This is recorded against your name and can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Field className="px-4">
            <FieldLabel htmlFor={`order-clear-reason-${order.id}`}>Reason</FieldLabel>
            <Input
              id={`order-clear-reason-${order.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Guest cancelled the order"
            />
          </Field>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setReason("")}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={!reason.trim() || pending}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={clearOrder}
            >
              Clear order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
