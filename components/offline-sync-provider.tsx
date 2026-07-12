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
  enqueuePayment: (p: Extract<QueueEntry, { kind: "payment" }>["payload"]) => Promise<void>
  enqueueOrder: (p: Extract<QueueEntry, { kind: "order" }>["payload"]) => Promise<void>
  syncNow: () => Promise<void>
}

const Ctx = createContext<OfflineCtx | null>(null)

async function replay(entry: QueueEntry): Promise<boolean> {
  if (entry.kind === "payment") {
    const res = await takePayment(
      entry.payload.billId,
      entry.payload.method,
      entry.payload.amountCents,
      entry.key,
    )
    return !res || !("error" in res)
  }
  const res = await placeStaffOrder(entry.key, entry.payload.tableId, entry.payload.items)
  return "ok" in res
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
        let success = false
        try {
          success = await replay(entry)
        } catch {
          success = false
        }
        if (success) {
          await removeEntry(entry.id)
          ok++
        } else {
          // Failed replay — give up after MAX_ATTEMPTS so a permanently-bad
          // entry (e.g. an item that got 86'd) doesn't retry forever.
          const attempts = await bumpAttempt(entry.id)
          if (attempts >= MAX_ATTEMPTS) {
            await removeEntry(entry.id)
            dropped++
          }
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
    async (p) => {
      await enqueue({ kind: "payment", payload: p })
      await refreshCount()
      toast.message("Payment queued — will sync when back online.")
    },
    [refreshCount],
  )
  const enqueueOrder = useCallback<OfflineCtx["enqueueOrder"]>(
    async (p) => {
      await enqueue({ kind: "order", payload: p })
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
