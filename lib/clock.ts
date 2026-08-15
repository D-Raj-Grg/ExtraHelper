/**
 * A shared minute clock for "2m ago" style labels.
 *
 * `Date.now()` read during render hydration-mismatches and never re-renders on
 * its own, so subscribe to it as an external store instead: the snapshot is
 * rounded down to the minute (stable between ticks, so React doesn't loop) and
 * the server snapshot is `null`, letting callers render an absolute time until
 * the client takes over.
 */
export const MINUTE_MS = 60_000

export function subscribeMinute(onChange: () => void): () => void {
  const t = setInterval(onChange, MINUTE_MS)
  return () => clearInterval(t)
}

/** Now, rounded down to the minute — a stable snapshot between ticks. */
export function minuteNow(): number {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS
}
