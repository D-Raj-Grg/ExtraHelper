"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRightIcon, WifiOffIcon } from "lucide-react"

import { fireOrder, placeStaffOrder } from "@/app/(app)/pos/actions"
import { Button } from "@/components/ui/button"
import { useOffline } from "@/components/offline-sync-provider"
import { DestinationStep } from "@/components/pos/destination-step"
import { DishStep } from "@/components/pos/dish-step"
import { EMPTY_CHECK_IN, type CheckIn } from "@/components/pos/check-in-details"
import { toPlaceLines } from "@/components/pos/cart-types"
import { useCreateCart } from "@/components/pos/use-create-cart"
import { TAKEAWAY, type PosData } from "@/components/pos/types"

/**
 * Fresh idempotency key. Module scope, not the component body: it reads
 * Date.now/Math.random, which must never run during render.
 */
function newKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

type Step = "destination" | "dishes"

/**
 * Compose a new order: destination, then dishes, then Confirm — one atomic
 * call. Works offline; a composed order queues and replays on reconnect.
 */
export function CreateFlow({
  data,
  currency,
  onClose,
  initialTableId,
}: {
  data: PosData
  currency: string
  onClose: () => void
  /** Preselect this table (from the Table tab). Still changeable on step 1. */
  initialTableId?: string
}) {
  const router = useRouter()
  const { online, enqueueOrder } = useOffline()
  const [pending, startTransition] = useTransition()

  const [step, setStep] = useState<Step>("destination")
  const [tableId, setTableId] = useState<string>(initialTableId ?? TAKEAWAY)
  const [checkIn, setCheckIn] = useState<CheckIn>(EMPTY_CHECK_IN)
  const cart = useCreateCart()

  // One idempotency key per submission, reused across retries until it
  // succeeds, so a timed-out-but-committed placement can't duplicate the order.
  const submitKey = useRef<string | null>(null)

  const table = data.tables.find((t) => t.id === tableId)
  const destinationLabel = table ? `Table ${table.label}` : "Takeaway"

  function confirm(alsoFire: boolean) {
    if (cart.lines.length === 0) return
    const items = toPlaceLines(cart.lines)
    const meta = {
      guests: checkIn.guests,
      waiterId: checkIn.waiterId,
      customerId: checkIn.customerId,
      customerName: checkIn.customerName.trim() || null,
      customerPhone: checkIn.customerPhone.trim() || null,
    }
    const payload = { tableId: tableId || null, items, label: destinationLabel, meta }

    // Decide from live connectivity — the `online` state can lag the event.
    const offlineNow = typeof navigator !== "undefined" ? !navigator.onLine : !online
    if (offlineNow) {
      void enqueueOrder(payload)
      toast.success(`${destinationLabel} order queued — it'll send when you're back online.`)
      onClose()
      return
    }

    if (!submitKey.current) submitKey.current = newKey()
    const key = submitKey.current

    startTransition(async () => {
      try {
        const res = await placeStaffOrder(key, tableId || null, items, meta)
        if ("error" in res) {
          // Keep the cart and the key so a retry reuses it.
          toast.error(res.error)
          return
        }
        // One-tap path: fire the just-placed order to the kitchen before we
        // leave the create modal, so the common "take order, send it now" case
        // doesn't need a second tap on the amend screen. Fire needs the server,
        // so it only runs online (this branch is online-only already).
        if (alsoFire) {
          const fr = await fireOrder(res.orderId)
          if ("error" in fr) {
            // Order IS created — surface the fire error and let the amend screen
            // (below) open so the fire can be retried there. Never lost.
            toast.error(fr.error)
          } else {
            // No print popups here — tickets land on the KDS/KOT board and print
            // from there. Firing just routes items to the stations.
            if (fr.kotIds.length) toast.success(`Placed · ${fr.kotIds.length} ticket(s) to kitchen`)
          }
        }
        // Reopen against the real server rows: anything the server dropped — an
        // item 86'd while we were composing — is then visible rather than
        // assumed to have landed.
        //
        // Just the push, no onClose() first: onClose navigates too, and two
        // navigations in one tick race and leave you on neither. The route
        // change swaps this modal to amend mode on its own.
        router.push(`/pos/${res.orderId}`)
      } catch {
        // Network failure, maybe committed and maybe not. Queue with the SAME
        // key so replay dedups against any partial commit. Never silently lost.
        await enqueueOrder(payload, key)
        toast.success(`${destinationLabel} order queued — it'll send when you're back online.`)
        onClose()
      }
    })
  }

  if (step === "destination") {
    return (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <DestinationStep
            tables={data.tables}
            floors={data.floors}
            value={tableId}
            onChange={setTableId}
          />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t p-3">
          {!online ? <OfflineNote /> : <span />}
          <Button onClick={() => setStep("dishes")}>
            Choose dishes
            <ArrowRightIcon />
          </Button>
        </div>
      </>
    )
  }

  return (
    <DishStep
      menu={data.menu}
      categories={data.categories}
      cart={cart}
      currency={currency}
      destinationLabel={destinationLabel}
      onChangeDestination={() => setStep("destination")}
      checkIn={checkIn}
      onCheckInChange={setCheckIn}
      customers={data.customers}
      staff={data.staff}
      showGuests={tableId !== TAKEAWAY}
      footer={
        <div className="flex shrink-0 flex-col gap-2 border-t p-3">
          {!online ? <OfflineNote /> : null}
          {online ? (
            <>
              <Button
                size="lg"
                className="w-full"
                disabled={cart.lines.length === 0 || pending}
                onClick={() => confirm(true)}
              >
                {pending ? "Placing…" : "Confirm & fire"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full"
                disabled={cart.lines.length === 0 || pending}
                onClick={() => confirm(false)}
              >
                Confirm only
              </Button>
            </>
          ) : (
            <Button
              size="lg"
              className="w-full"
              disabled={cart.lines.length === 0 || pending}
              onClick={() => confirm(false)}
            >
              Queue order
            </Button>
          )}
        </div>
      }
    />
  )
}

function OfflineNote() {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
      <WifiOffIcon className="size-3.5" aria-hidden />
      Offline — this order will send when you reconnect.
    </span>
  )
}
