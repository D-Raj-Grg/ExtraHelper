import localforage from "localforage"

// IndexedDB-backed FIFO queue for writes captured while offline. Each entry
// carries a stable idempotency key so replay on reconnect can't double-apply.

export type PaymentMethod = "cash" | "card" | "online" | "wallet" | "points"

export type QueueEntry =
  | {
      id: string
      kind: "order"
      key: string
      createdAt: number
      payload: { tableId: string | null; items: { item_id: string; qty: number }[]; label: string }
    }
  | {
      id: string
      kind: "payment"
      key: string
      createdAt: number
      payload: { billId: string; method: PaymentMethod; amountCents: number; label: string }
    }

const store = localforage.createInstance({ name: "extrahelper", storeName: "sync_queue" })

function uuid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

export async function enqueue(
  entry: { kind: "order"; payload: Extract<QueueEntry, { kind: "order" }>["payload"] }
    | { kind: "payment"; payload: Extract<QueueEntry, { kind: "payment" }>["payload"] },
): Promise<QueueEntry> {
  const full = { ...entry, id: uuid(), key: uuid(), createdAt: Date.now() } as QueueEntry
  await store.setItem(full.id, full)
  return full
}

export async function listQueue(): Promise<QueueEntry[]> {
  const items: QueueEntry[] = []
  await store.iterate<QueueEntry, void>((v) => {
    items.push(v)
  })
  return items.sort((a, b) => a.createdAt - b.createdAt)
}

export async function removeEntry(id: string): Promise<void> {
  await store.removeItem(id)
}

export async function queueCount(): Promise<number> {
  return store.length()
}
