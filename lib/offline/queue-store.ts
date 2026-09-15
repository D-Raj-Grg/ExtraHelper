import { queueCount } from "@/lib/offline/queue"

/**
 * Subscribable view of how many writes are sitting in the offline queue.
 *
 * The queue itself lives in IndexedDB, so its size can only be read
 * asynchronously — which is why it cannot be read directly in a
 * `useSyncExternalStore` snapshot. This keeps the last known count in module
 * scope, refreshed explicitly after every mutation, so components read it
 * synchronously and re-render only when the number actually changes.
 */
let count = 0
const listeners = new Set<() => void>()

/** Subscribe to count changes. Returns the unsubscribe function. */
export function subscribeQueueCount(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** Last known queue size. Synchronous by design — see `refreshQueueCount`. */
export function getQueueCount(): number {
  return count
}

/** Nothing is queued on the server; the client corrects this on first read. */
export function getServerQueueCount(): number {
  return 0
}

/**
 * Re-read the queue and notify subscribers if the size changed. Call after any
 * enqueue, replay or drop. Notifying only on a real change is what keeps this
 * from re-rendering every consumer on each sync tick.
 */
export async function refreshQueueCount(): Promise<void> {
  const next = await queueCount()
  if (next === count) return
  count = next
  for (const listener of listeners) listener()
}
