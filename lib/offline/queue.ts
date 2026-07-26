import localforage from "localforage"

import type { OrderMeta, PlaceLine } from "@/app/(app)/pos/actions"

// IndexedDB-backed FIFO queue for writes captured while offline. Each entry
// carries a stable idempotency key so replay on reconnect can't double-apply.

export type PaymentMethod = "cash" | "card" | "online" | "wallet" | "points"

export type QueueEntry =
  | {
      id: string
      kind: "order"
      key: string
      createdAt: number
      attempts: number
      // PlaceLine's fields are all optional bar `qty`, so an entry queued by an
      // older build — items of `{item_id, qty}`, no `meta` — still satisfies
      // this and replays cleanly. Don't tighten it without draining the queue.
      payload: {
        tableId: string | null
        items: PlaceLine[]
        label: string
        meta?: OrderMeta
      }
    }
  | {
      id: string
      kind: "payment"
      key: string
      createdAt: number
      attempts: number
      payload: { billId: string; method: PaymentMethod; amountCents: number; label: string }
    }

/** Give up on a stuck entry after this many failed replays. */
export const MAX_ATTEMPTS = 5

const store = localforage.createInstance({ name: "extrahelper", storeName: "sync_queue" })

function uuid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

export async function enqueue(
  entry:
    | { kind: "order"; payload: Extract<QueueEntry, { kind: "order" }>["payload"]; key?: string }
    | { kind: "payment"; payload: Extract<QueueEntry, { kind: "payment" }>["payload"]; key?: string },
): Promise<QueueEntry> {
  // A caller may pass an existing key (e.g. an online call that already tried
  // the server with that key and timed out) so replay dedups instead of dupes.
  const full = { ...entry, id: uuid(), key: entry.key ?? uuid(), createdAt: Date.now(), attempts: 0 } as QueueEntry
  await store.setItem(full.id, full)
  return full
}

/** Record a failed replay; returns the new attempt count. */
export async function bumpAttempt(id: string): Promise<number> {
  const e = await store.getItem<QueueEntry>(id)
  if (!e) return MAX_ATTEMPTS
  const next = { ...e, attempts: (e.attempts ?? 0) + 1 }
  await store.setItem(id, next)
  return next.attempts
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
