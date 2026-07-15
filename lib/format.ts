/**
 * Currency formatting. Locale is PINNED ("en-US") — using the runtime default
 * (`undefined`) makes the server (Node ICU) and client (browser) disagree
 * (e.g. "US$12.00" vs "$12.00"), causing React hydration mismatches. A fixed
 * locale renders identically on both. (Full locale-awareness is a later i18n task.)
 */
export function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
      cents / 100,
    )
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`
  }
}

/**
 * Date/time formatting for SSR'd client components. Locale AND timeZone are
 * pinned — `toLocaleString()`'s runtime defaults differ between the Node server
 * (often UTC) and the browser (user locale/TZ), which hydration-mismatches.
 * Pass the tenant's timezone for correct local display; defaults to UTC.
 */
export function formatDateTime(iso: string, timeZone = "UTC"): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toISOString()
  }
}

/** Displacement (ms) of `date` when rendered in `timeZone` vs UTC. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  )
  const hour = p.hour === "24" ? "00" : p.hour
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second)
  return asUtc - date.getTime()
}

/**
 * Interpret a timezone-less wall-clock string (a `datetime-local` value like
 * "2026-07-12T19:00") as local time in `timeZone`, returning the matching UTC
 * instant. Without this, `new Date(wall)` parses in the SERVER's zone (UTC in
 * prod), so a host entering 7pm is stored hours off for e.g. Asia/Kolkata.
 */
export function zonedTimeToUtc(wall: string, timeZone: string): Date {
  const guess = new Date(`${wall}Z`)
  if (Number.isNaN(guess.getTime())) return new Date(NaN)
  return new Date(guess.getTime() - tzOffsetMs(guess, timeZone))
}
