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
 * A span of prices — "NPR 1,080.00 – NPR 1,680.00" — collapsing to a single
 * price when the ends match.
 *
 * Built on money() rather than reaching for Intl again, so the pinned locale
 * (and the hydration fix it exists for) carries over for free.
 */
export function moneyRange(minCents: number, maxCents: number, currency: string): string {
  if (minCents === maxCents) return money(minCents, currency)
  const lo = money(minCents, currency)
  const hi = money(maxCents, currency)
  // "NPR 1,080.00 – 1,680.00" rather than repeating the currency: on a POS tile
  // read at arm's length the second "NPR" is three lines of wrap for no
  // information. Only collapse when the currency actually leads both — where it
  // trails the number, the prefix match fails and we keep the full form.
  const prefix = hi.match(/^\D+/)?.[0] ?? ""
  if (prefix && lo.startsWith(prefix)) return `${lo} – ${hi.slice(prefix.length)}`
  // En dash: this is a range, not a subtraction.
  return `${lo} – ${hi}`
}

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen",
  "Nineteen",
]
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

/** 0–999 in words. Helper for amountInWords. */
function under1000(n: number): string {
  if (n < 20) return ONES[n]
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)]
    const r = n % 10
    return r ? `${t} ${ONES[r]}` : t
  }
  const h = `${ONES[Math.floor(n / 100)]} Hundred`
  const r = n % 100
  return r ? `${h} ${under1000(r)}` : h
}

/**
 * "Seven Hundred Ninety Five NPR Only" — the amount-in-words line every printed
 * invoice carries, so a total can't be altered by a pen stroke.
 *
 * Hand-rolled rather than `Intl.NumberFormat`: no browser exposes a words style,
 * and a hand-rolled scale renders identically on server and client (the same
 * hydration reason money() pins its locale). Currency is the tenant's CODE, not
 * a hardcoded currency name — rule #2.
 */
export function amountInWords(cents: number, currency: string): string {
  const neg = cents < 0
  const whole = Math.floor(Math.abs(cents) / 100)
  const minor = Math.abs(cents) % 100

  const groups: [number, string][] = [
    [1_000_000_000, "Billion"],
    [1_000_000, "Million"],
    [1_000, "Thousand"],
  ]
  let rest = whole
  const parts: string[] = []
  for (const [size, name] of groups) {
    const q = Math.floor(rest / size)
    if (q > 0) {
      parts.push(`${under1000(q)} ${name}`)
      rest -= q * size
    }
  }
  if (rest > 0 || parts.length === 0) parts.push(under1000(rest))

  const main = parts.join(" ")
  // Minor units stay numeric ("and 40/100"): naming them (Paisa, Cents, Fils…)
  // would hardcode one country's currency into every tenant's invoice.
  const fraction = minor > 0 ? ` and ${String(minor).padStart(2, "0")}/100` : ""
  return `${neg ? "Minus " : ""}${main}${fraction} ${currency} Only`
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

/**
 * "Just now" / "12m ago" / "3h ago" / "2d ago". `now` comes from the caller
 * (see `lib/clock.ts`) rather than `Date.now()` so the value is stable across a
 * render pass; pass `null` on the server and get an absolute time back instead.
 */
export function relativeTime(iso: string, now: number | null, timeZone = "UTC"): string {
  if (now === null) return formatDateTime(iso, timeZone)
  const diff = now - new Date(iso).getTime()
  if (diff < 60_000) return "Just now"
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDateTime(iso, timeZone)
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
 * The UTC instant at which the tenant's business day containing `at` begins.
 *
 * "Today" on a POS is the restaurant's today, not the server's — a till in
 * Kathmandu closing at 23:00 local is already tomorrow in UTC. Lives here rather
 * than in report-range so client components can import it too (this module has
 * no server imports); report-range keeps its own tzMidnight, which takes a
 * user-typed "YYYY-MM-DD" rather than an instant.
 *
 * `cutoffMinutes` moves the turnover off midnight — 240 means the day rolls at
 * 4am, so a sale at 01:30 still belongs to the night before. It is passed in,
 * never read from the server here: that would drag `next/headers` into the
 * browser bundle. Callers get it from `ActiveTenant.dayCutoffMinutes`, and the
 * SQL twin is `public.tenant_day_start` / `public.business_day`.
 */
export function tzDayStart(at: Date, timeZone: string, cutoffMinutes = 0): Date {
  const [y, mo, d] = businessDay(at, timeZone, cutoffMinutes).split("-").map(Number)
  return utcFromWall(Date.UTC(y, mo - 1, d) + cutoffMinutes * 60_000, timeZone)
}

/**
 * Which business day an instant falls in, as "YYYY-MM-DD" — the TS twin of
 * `public.business_day`, and the key the day-close sheet is addressed by.
 *
 * The cutoff is subtracted from the LOCAL wall clock, not from the UTC instant,
 * because that is what `business_day` does: `(at at time zone tz) - interval`.
 * Subtracting in UTC first agrees with it on every ordinary day and disagrees on
 * the two DST-transition days a year, where the offset differs either side of
 * the shift — an hour is enough to land a 4am cutoff on the wrong date.
 */
export function businessDay(at: Date, timeZone: string, cutoffMinutes = 0): string {
  const wall = new Date(wallClockMs(at, timeZone) - cutoffMinutes * 60_000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${wall.getUTCFullYear()}-${p(wall.getUTCMonth() + 1)}-${p(wall.getUTCDate())}`
}

/**
 * `at`'s wall clock in `timeZone`, encoded as if it were UTC — so it can be
 * shifted and read back with plain getUTC* calls, with no zone maths in between.
 */
function wallClockMs(at: Date, timeZone: string): number {
  return at.getTime() + tzOffsetMs(at, timeZone)
}

/**
 * The reverse: the UTC instant at which a given wall clock occurs in `timeZone`.
 *
 * Matching Postgres exactly is the whole job — the client-side day bound and the
 * server-side one have to agree to the millisecond, or the POS and the day-close
 * sheet disagree about which sales are today.
 *
 * An offset can only be sampled at an instant, and the instant is what we are
 * solving for. So sample well either side of the wall time, which gives one
 * candidate per offset in play; keep the candidates that actually read back as
 * the wall time asked for, and take the LATEST.
 *
 * The bracket is 26 hours, not 12. A wall clock read as if it were UTC sits up
 * to 14 hours from the instant it names (Kiritimati is +14, Baker Island −12),
 * so a 12-hour reach can land BOTH probes on the same side of a shift and never
 * generate the other offset at all — which is exactly how Chatham (+13:45) came
 * out an hour late. 14 for the offset plus 12 to clear the shift is 26.
 *
 * That single rule covers both awkward hours of the year, which is why it is
 * expressed as one rule rather than as special cases:
 *  - Fall back, where a wall time happens twice: both candidates are valid and
 *    the later (standard time) wins, which is what Postgres returns.
 *  - Spring forward, where a wall time never happens: neither is valid, and the
 *    later is the instant the clock jumps to — 02:00 becomes 03:00, not 01:00.
 *    Postgres resolves the gap forwards too.
 *
 * Verified against Postgres over 89,928 probes: twelve zones — including the
 * half-hour shift of Lord Howe, the 12:45 offset of Chatham, southern-hemisphere
 * Santiago and Asuncion, and no-DST Kolkata — six cutoffs, every seven hours
 * across a full year. Three earlier versions passed a spot check and failed that
 * sweep: probing at local noon broke ordinary spring-forward days, one pass
 * broke later cutoffs, and iterating to a fixed point broke the skipped hour.
 */
function utcFromWall(wallMs: number, timeZone: string): Date {
  const REACH = 26 * 3600_000
  const candidate = (probe: number) => wallMs - tzOffsetMs(new Date(probe), timeZone)
  const readsBack = (utc: number) => utc + tzOffsetMs(new Date(utc), timeZone) === wallMs

  const all = [candidate(wallMs - REACH), candidate(wallMs + REACH)]
  const valid = all.filter(readsBack)
  return new Date(Math.max(...(valid.length ? valid : all)))
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
