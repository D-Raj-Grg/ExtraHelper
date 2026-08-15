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
import { TAKEAWAY, type PosComposerData } from "@/components/pos/types"

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
  // Composer data, not the whole board: this flow also runs from the sidebar's
  // New order dialog, which never loads orders/kots/completed.
  data: PosComposerData
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

  function confirm() {
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
        // Confirming IS sending: an order the kitchen can't see isn't confirmed
        // in any sense a waiter means, so there is no "place but don't fire"
        // path here. Fire needs the server, which this branch already has
        // (offline short-circuits above and replays with a fire on reconnect).
        const fr = await fireOrder(res.orderId)
        if ("error" in fr) {
          // Order IS created but the kitchen can't see it. This composer also
          // opens from the sidebar over /inventory or /reports, so navigating
          // to the amend screen outright would yank someone out of unrelated
          // work — the escape hatch rides on the toast instead, and they choose.
          //
          // duration: Infinity is load-bearing. An order stuck outside the
          // kitchen must not quietly fade off screen on a timer; this one sits
          // there until it's dismissed or acted on.
          toast.error(fr.error, {
            duration: Infinity,
            action: {
              label: "Open order",
              onClick: () => router.push(`/pos/${res.orderId}`),
            },
          })
          onClose()
          return
        }
        // Zero tickets is a real outcome (every line already on a ticket, or
        // printed the instant it was made) — still say the order went, never
        // close on silence.
        toast.success(
          fr.kotIds.length
            ? `Placed · ${fr.kotIds.length} ticket(s) to kitchen`
            : `${destinationLabel} order sent to the kitchen`,
        )
        // Nothing is printed from here. Creating the tickets queues them in
        // Postgres, so they come out wherever the printers are — including
        // when this till is not the machine wired to the kitchen.
        // Taking an order ends here: back to the board. Billing is a separate
        // decision made later from the order card, not a step tacked onto
        // ordering. onClose refetches (or drops the deep link back to /pos),
        // so the new card — as the server actually stored it, 86'd items and
        // all — is what you see.
        onClose()
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
            // Tapping a table IS the answer to "where does this go?" — no
            // reason to make a waiter confirm it with a second tap. The footer
            // button stays for the keyboard path and for the default takeaway.
            onCommit={(id) => {
              setTableId(id)
              setStep("dishes")
            }}
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
          <Button
            size="lg"
            className="w-full"
            disabled={cart.lines.length === 0 || pending}
            onClick={() => confirm()}
          >
            {online ? (pending ? "Placing…" : "Confirm & fire") : "Queue order"}
          </Button>
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
