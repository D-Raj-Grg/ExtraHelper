"use client"

import { useCallback, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CircleAlertIcon, PauseIcon, ReceiptIcon, SendIcon } from "lucide-react"

import { fireOrder, setOrderDetails } from "@/app/(app)/pos/actions"
import { generateBill } from "@/app/(app)/bill/actions"
import { billStatusLabel, orderStatusLabel } from "@/lib/order-constants"
import { Button } from "@/components/ui/button"
import { DishStep } from "@/components/pos/dish-step"
import { EMPTY_CHECK_IN, type CheckIn } from "@/components/pos/check-in-details"
import { useAmendCart } from "@/components/pos/use-amend-cart"
import type { PosComposerData, PosOrderDetail } from "@/components/pos/types"

/**
 * A line the kitchen hasn't been told about yet. Same test fire_order uses to
 * pick what goes on the next ticket: not void, not held, still draft/placed.
 * Voided lines never reach the cart, so only the other two matter here.
 */
const UNFIRED_LINE_STATUSES = ["draft", "placed"]

/**
 * Amend an existing order: same grid, same rail, but every edit lands on the
 * server as it happens. Ends in Fire to kitchen, or Generate bill once fired.
 */
export function AmendFlow({
  detail,
  data,
  currency,
  refetch,
  onClose,
}: {
  detail: PosOrderDetail
  /**
   * Only the composer half — the menu, the pickers. Not the board's orders.
   *
   * Widened from `PosData` so amending isn't tied to /pos having already
   * loaded: the checkout screen opens this over a bill, where there is no
   * board. `PosData` satisfies it structurally, so /pos passes its full
   * payload down unchanged.
   */
  data: PosComposerData
  currency: string
  refetch: () => void
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const cart = useAmendCart(detail, refetch)

  // Two different questions, and conflating them is what used to grey out the
  // whole dish grid on any fired order.
  //
  // `unfired` = has this order been to the kitchen at all? It only decides
  // which footer button shows, never whether a dish can be tapped.
  //
  // `addable` = the same rule the database enforces: anything short of
  // closed/cancelled takes new items, and a billed order takes them while its
  // bill is still open. Line-level edits (delete vs void-with-reason) are
  // untouched — they still live in useAmendCart.
  const unfired = detail.status === "draft" || detail.status === "placed"
  const billStatus = detail.bills?.status ?? null
  const addable =
    detail.status !== "closed" &&
    detail.status !== "cancelled" &&
    (detail.status !== "billed" || billStatus === "open")

  const heldCount = cart.lines.filter((l) => l.isHeld).length
  const allHeld = cart.lines.length > 0 && heldCount === cart.lines.length

  // Lines added since the last fire — what a "Send new items" tap would print.
  const newItemCount = cart.lines.filter(
    (l) => !l.isHeld && UNFIRED_LINE_STATUSES.includes(l.status ?? ""),
  ).length

  const destinationLabel = detail.restaurant_tables?.label
    ? `Table ${detail.restaurant_tables.label}`
    : "Takeaway"

  // Check-in is server-backed here, so the panel shows what's stored and each
  // change is written through. Seeded by order **id**, not by value: a Realtime
  // refresh re-sends the same detail object constantly, and reseeding on value
  // would stomp whatever the waiter is typing.
  //
  // Adjusted during render rather than in an effect — an effect would paint the
  // previous order's check-in for a frame first.
  const [checkIn, setCheckIn] = useState<CheckIn>(EMPTY_CHECK_IN)
  const [seededId, setSeededId] = useState<string | null>(null)
  if (seededId !== detail.id) {
    setSeededId(detail.id)
    setCheckIn({
      customerId: detail.customer_id,
      customerName: "",
      customerPhone: "",
      guests: detail.guests,
      waiterId: detail.waiter_id,
    })
  }

  const commitCheckIn = useCallback(
    (next: CheckIn) => {
      setCheckIn(next)
      startTransition(async () => {
        const res = await setOrderDetails(detail.id, {
          guests: next.guests,
          waiterId: next.waiterId,
          ...(next.customerId
            ? { customerId: next.customerId }
            : { customerName: next.customerName || null, customerPhone: next.customerPhone || null }),
        })
        if (res && "error" in res) {
          toast.error(res.error)
          return
        }
        refetch()
      })
    },
    [detail.id, refetch],
  )

  function fire() {
    startTransition(async () => {
      const res = await fireOrder(detail.id)
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      // One ticket per station, queued by the database as the tickets are
      // created — nothing to print from here.
      refetch()
    })
  }

  function bill() {
    startTransition(async () => {
      const res = await generateBill(detail.id)
      if (res && "error" in res) toast.error(res.error)
      else onClose()
    })
  }

  return (
    <DishStep
      menu={data.menu}
      categories={data.categories}
      cart={cart}
      currency={currency}
      destinationLabel={destinationLabel}
      // No onChangeDestination: the order is already seated. Moving it is a
      // table transfer, which lives on the floor map with its own rules.
      checkIn={checkIn}
      onCheckInChange={commitCheckIn}
      customers={data.customers}
      staff={data.staff}
      showGuests={detail.table_id !== null}
      addDisabled={!addable}
      // Name the actual reason. "Paid" is wrong for a part-paid or voided
      // bill, and a waiter who's told the wrong thing goes looking for a bug.
      addNotice={
        addable
          ? null
          : detail.status === "cancelled"
            ? "This order was cancelled — start a new order for anything else."
            : billStatus === "partial"
              ? "This bill has already taken a payment — start a new order for anything else."
              : billStatus === "void"
                ? "This bill was voided — start a new order for anything else."
                : "This bill is paid — start a new order for anything else."
      }
      footer={
        <div className="flex shrink-0 flex-col gap-2 border-t p-3">
          {heldCount > 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <PauseIcon className="size-3.5 shrink-0" aria-hidden />
              {heldCount} item{heldCount === 1 ? "" : "s"} held — {heldCount === 1 ? "it won't" : "they won't"} fire
            </p>
          ) : null}

          {unfired ? (
            <>
              <Button
                size="lg"
                className="min-h-11 w-full"
                disabled={pending || cart.busy || cart.lines.length === 0 || allHeld}
                onClick={fire}
              >
                {pending ? "Firing…" : "Fire to kitchen"}
              </Button>
              {allHeld ? (
                <p className="text-center text-xs text-muted-foreground">
                  Every item is held — release one to fire.
                </p>
              ) : null}
            </>
          ) : (
            <>
              {/* Already fired once, and something new has been added since —
                  the kitchen still has to be told. Same action as the first
                  fire; fire_order only ever tickets lines that have no kot_item
                  yet, so this can't reprint what's already cooking.

                  Gated on `addable` as well as on the count, and that second
                  test is load-bearing: `fire_order` checks tenant membership
                  and nothing else, so on a paid-and-closed order carrying a
                  draft line somebody added and never sent, this button would
                  happily cook an item that no bill will ever charge for. */}
              {addable && newItemCount > 0 ? (
                <Button
                  size="lg"
                  className="min-h-11 w-full"
                  disabled={pending || cart.busy}
                  onClick={fire}
                >
                  <SendIcon />
                  {pending
                    ? "Sending…"
                    : `Send ${newItemCount} new item${newItemCount === 1 ? "" : "s"}`}
                </Button>
              ) : null}

              {detail.status === "billed" && billStatus === "open" ? (
                <>
                  <p className="flex items-center justify-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
                    <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                    Billed · {billStatusLabel("open").toLowerCase()}
                  </p>
                  {detail.bill_id ? (
                    <Button
                      variant="outline"
                      size="lg"
                      className="min-h-11 w-full"
                      nativeButton={false}
                      // Closes as well as navigates, because this pane opens in
                      // two places: over the board, where the tap should land
                      // on the bill — and over the bill itself, where without
                      // this the route would change underneath a dialog that
                      // stayed open.
                      onClick={onClose}
                      render={<Link href={`/bill/${detail.bill_id}`} />}
                    >
                      <ReceiptIcon />
                      Finish the bill
                    </Button>
                  ) : null}
                </>
              ) : detail.status === "billed" ||
                detail.status === "closed" ||
                detail.status === "cancelled" ? (
                <p className="text-center text-sm text-muted-foreground">
                  {orderStatusLabel(detail.status)}
                  {billStatus ? ` · ${billStatusLabel(billStatus)}` : ""}
                </p>
              ) : (
                <>
                  {/* Billing snapshots every non-void line, draft ones included
                      — so billing now would charge for the items still sitting
                      unsent above this button. Adding to a fired order is new
                      (it used to be impossible), which is what put these two
                      controls side by side in the first place. */}
                  {newItemCount > 0 ? (
                    <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                      Send the new{" "}
                      {newItemCount === 1 ? "item" : `${newItemCount} items`} to the kitchen
                      first — billing now charges for {newItemCount === 1 ? "it" : "them"}.
                    </p>
                  ) : null}
                  <Button
                    size="lg"
                    className="min-h-11 w-full"
                    disabled={pending || newItemCount > 0}
                    onClick={bill}
                  >
                    <ReceiptIcon />
                    {pending ? "Opening bill…" : "Generate bill"}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      }
    />
  )
}
