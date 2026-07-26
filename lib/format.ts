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
