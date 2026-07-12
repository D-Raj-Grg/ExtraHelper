"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { placeStaffOrder } from "@/app/(app)/pos/actions"
import { takePayment } from "@/app/(app)/bill/actions"
import {
  MAX_ATTEMPTS,
  bumpAttempt,
  enqueue,
  listQueue,
  queueCount,
  removeEntry,
  type QueueEntry,
} from "@/lib/offline/queue"

type OfflineCtx = {
  online: boolean
  pending: number
  enqueuePayment: (p: Extract<QueueEntry, { kind: "payment" }>["payload"], key?: string) => Promise<void>
  enqueueOrder: (p: Extract<QueueEntry, { kind: "order" }>["payload"], key?: string) => Promise<void>
  syncNow: () => Promise<void>
}

const Ctx = createContext<OfflineCtx | null>(null)

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
      )
      return res && "error" in res ? "reject" : "ok"
    }
    const res = await placeStaffOrder(entry.key, entry.payload.tableId, entry.payload.items)
    return "ok" in res ? "ok" : "reject"
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
  const [online, setOnline] = useState(true)
  const [pending, setPending] = useState(0)
  const syncing = useRef(false)

  const refreshCount = useCallback(async () => {
    setPending(await queueCount())
  }, [])

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
      await refreshCount()
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
  }, [refreshCount, router])

  useEffect(() => {
    setOnline(navigator.onLine)
    void refreshCount()
    const goOnline = () => {
      setOnline(true)
      void syncNow()
    }
    const goOffline = () => setOnline(false)
    window.addEventListener("online", goOnline)
    window.addEventListener("offline", goOffline)
    if (navigator.onLine) void syncNow()
    return () => {
      window.removeEventListener("online", goOnline)
      window.removeEventListener("offline", goOffline)
    }
  }, [refreshCount, syncNow])

  const enqueuePayment = useCallback<OfflineCtx["enqueuePayment"]>(
    async (p, key) => {
      await enqueue({ kind: "payment", payload: p, key })
      await refreshCount()
      toast.message("Payment queued — will sync when back online.")
    },
    [refreshCount],
  )
  const enqueueOrder = useCallback<OfflineCtx["enqueueOrder"]>(
    async (p, key) => {
      await enqueue({ kind: "order", payload: p, key })
      await refreshCount()
      toast.message("Order queued — will sync when back online.")
    },
    [refreshCount],
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
