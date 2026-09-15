"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { fireOrder, placeStaffOrder } from "@/app/(app)/pos/actions"
import { takePayment } from "@/app/(app)/bill/actions"
import {
  MAX_ATTEMPTS,
  bumpAttempt,
  enqueue,
  listQueue,
  removeEntry,
  type QueueEntry,
} from "@/lib/offline/queue"
import {
  getQueueCount,
  getServerQueueCount,
  refreshQueueCount,
  subscribeQueueCount,
} from "@/lib/offline/queue-store"

type OfflineCtx = {
  online: boolean
  pending: number
  enqueuePayment: (p: Extract<QueueEntry, { kind: "payment" }>["payload"], key?: string) => Promise<void>
  enqueueOrder: (p: Extract<QueueEntry, { kind: "order" }>["payload"], key?: string) => Promise<void>
  syncNow: () => Promise<void>
}

const Ctx = createContext<OfflineCtx | null>(null)

/**
 * Connectivity read as the external store it is, rather than mirrored into
 * state from an effect. `navigator.onLine` is already the source of truth and
 * the browser already has an event for it — copying it into `useState` on
 * mount meant a second render on every page load just to learn what the
 * browser could have told us directly.
 *
 * The server snapshot is `true`: there is no connectivity to report during
 * SSR, and assuming online matches what the markup is rendered for. A genuinely
 * offline client corrects it on the first client render.
 */
function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

// "ok" = applied, "reject" = server refused (validation → count toward drop),
// "retry" = transient/network (leave in queue, do NOT burn an attempt).
type ReplayResult = "ok" | "reject" | "retry"

async function replay(entry: QueueEntry): Promise<ReplayResult> {
  try {
    if (entry.kind === "payment") {
      const res = await takePayment(
        entry.payload.billId,
        entry.payload.method,
        entry.payload.amountCents,
        entry.key,
        entry.payload.reference,
      )
      return res && "error" in res ? "reject" : "ok"
    }
    const res = await placeStaffOrder(
      entry.key,
      entry.payload.tableId,
      entry.payload.items,
      entry.payload.meta ?? {},
    )
    if (!("ok" in res)) return "reject"
    // Confirming an order online fires it, so a replayed one has to fire too —
    // otherwise a queued order syncs and then sits invisible to the kitchen.
    // Best-effort: the placement is already committed, so a fire failure must
    // still report "ok" (a "retry" would re-run place on the next sync). The
    // order lands un-fired and can be fired from the order screen.
    const fr = await fireOrder(res.orderId)
    if ("error" in fr) {
      toast.error("Order synced but not sent to kitchen — fire it from the order.")
    }
    return "ok"
  } catch {
    return "retry" // network/throw — don't count against the attempt cap
  }
}

/**
 * Tracks connectivity + the offline write queue. Replays queued orders/payments
 * on reconnect (idempotent via stored keys). Wrap the app shell with it.
 */
export function OfflineSyncProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  )
  const pending = useSyncExternalStore(
    subscribeQueueCount,
    getQueueCount,
    getServerQueueCount,
  )
  const syncing = useRef(false)

  const syncNow = useCallback(async () => {
    if (syncing.current || typeof navigator !== "undefined" && !navigator.onLine) return
    syncing.current = true
    try {
      const entries = await listQueue()
      let ok = 0
      let dropped = 0
      for (const entry of entries) {
        if (typeof navigator !== "undefined" && !navigator.onLine) break // went offline mid-sync
        const r = await replay(entry)
        if (r === "ok") {
          await removeEntry(entry.id)
          ok++
        } else if (r === "reject") {
          // Definitive server refusal (e.g. all items 86'd) — give up after
          // MAX_ATTEMPTS so it doesn't retry forever. Transient errors ("retry")
          // never reach here, so flaky Wi-Fi can't burn the cap.
          const attempts = await bumpAttempt(entry.id)
          if (attempts >= MAX_ATTEMPTS) {
            await removeEntry(entry.id)
            dropped++
          }
        } else {
          break // transient — stop, retry the whole batch on next reconnect
        }
      }
      await refreshQueueCount()
      if (ok > 0) {
        toast.success(`Synced ${ok} offline ${ok === 1 ? "action" : "actions"}.`)
        router.refresh()
      }
      if (dropped > 0) {
        toast.error(`Dropped ${dropped} offline ${dropped === 1 ? "action" : "actions"} that couldn't sync.`)
      }
    } finally {
      syncing.current = false
    }
  }, [router])

  // `online` above reports connectivity; this effect is only the side effect of
  // regaining it — drain the queue. Both the listener and the mount call are
  // guarded by `syncNow` itself, which no-ops while offline or already syncing.
  useEffect(() => {
    void refreshQueueCount()
    const goOnline = () => void syncNow()
    window.addEventListener("online", goOnline)
    if (navigator.onLine) void syncNow()
    return () => window.removeEventListener("online", goOnline)
  }, [syncNow])

  const enqueuePayment = useCallback<OfflineCtx["enqueuePayment"]>(
    async (p, key) => {
      await enqueue({ kind: "payment", payload: p, key })
      await refreshQueueCount()
      toast.message("Payment queued — will sync when back online.")
    },
    [],
  )
  const enqueueOrder = useCallback<OfflineCtx["enqueueOrder"]>(
    async (p, key) => {
      await enqueue({ kind: "order", payload: p, key })
      await refreshQueueCount()
      toast.message("Order queued — will sync when back online.")
    },
    [],
  )

  return (
    <Ctx.Provider value={{ online, pending, enqueuePayment, enqueueOrder, syncNow }}>
      {children}
    </Ctx.Provider>
  )
}

export function useOffline(): OfflineCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useOffline must be used within OfflineSyncProvider")
  return ctx
}
