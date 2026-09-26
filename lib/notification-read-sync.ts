/**
 * "Notifications were marked read" — broadcast between the header bell and the
 * /notifications page, which each keep their own copy of the read cursor.
 * Without it, marking read in one leaves the other showing a stale badge or
 * bold rows until its 45s poll.
 *
 * A plain module (no "use client"), so either side may import it; it only
 * touches `window` inside functions that run in the browser.
 */
const EVENT = "extrahelper:notifications-read"

export function announceNotificationsRead(tenantId: string): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: tenantId }))
}

export function onNotificationsRead(tenantId: string, handler: () => void): () => void {
  const listener = (e: Event) => {
    if ((e as CustomEvent<string>).detail === tenantId) handler()
  }
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
