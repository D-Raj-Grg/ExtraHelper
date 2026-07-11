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
