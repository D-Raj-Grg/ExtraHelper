"use client"

import { useCallback, useState, useTransition } from "react"
import { toast } from "sonner"
import { PauseIcon, ReceiptIcon } from "lucide-react"

import { fireOrder, setOrderDetails } from "@/app/(app)/pos/actions"
import { generateBill } from "@/app/(app)/bill/actions"
import { orderStatusLabel } from "@/lib/order-constants"
import { Button } from "@/components/ui/button"
import { DishStep } from "@/components/pos/dish-step"
import { EMPTY_CHECK_IN, type CheckIn } from "@/components/pos/check-in-details"
import { useAmendCart } from "@/components/pos/use-amend-cart"
import type { PosData, PosOrderDetail } from "@/components/pos/types"

/** Lines can still be edited in these states; after that it's a KOT amendment. */
const EDITABLE = ["draft", "placed"]

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
  data: PosData
  currency: string
  refetch: () => void
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const cart = useAmendCart(detail, refetch)

  const editable = EDITABLE.includes(detail.status)
  const heldCount = cart.lines.filter((l) => l.isHeld).length
  const allHeld = cart.lines.length > 0 && heldCount === cart.lines.length

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
      // A print view per station ticket. Blocked popups can still be printed
      // from the KDS board, so this isn't the only route.
      res.kotIds.forEach((id) => window.open(`/kot/${id}`, "_blank", "noopener"))
      if (res.kotIds.length) toast.success(`Fired · printing ${res.kotIds.length} ticket(s)`)
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
      addDisabled={!editable}
      footer={
        <div className="flex shrink-0 flex-col gap-2 border-t p-3">
          {heldCount > 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <PauseIcon className="size-3.5 shrink-0" aria-hidden />
              {heldCount} item{heldCount === 1 ? "" : "s"} held — {heldCount === 1 ? "it won't" : "they won't"} fire
            </p>
          ) : null}

          {editable ? (
            <>
              <Button
                size="lg"
                className="w-full"
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
          ) : detail.status === "billed" || detail.status === "closed" ? (
            <p className="text-center text-sm text-muted-foreground">
              {orderStatusLabel(detail.status)}
              {detail.status === "closed" ? " · paid" : ""}
            </p>
          ) : (
            <Button size="lg" className="w-full" disabled={pending} onClick={bill}>
              <ReceiptIcon />
              {pending ? "Opening bill…" : "Generate bill"}
            </Button>
          )}
        </div>
      }
    />
  )
}
