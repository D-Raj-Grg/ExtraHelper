import { tzOffsetMs } from "@/lib/format"

export const WINDOWS = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
  { key: "year", label: "365 days" },
  { key: "all", label: "All time" },
] as const

export type WindowKey = (typeof WINDOWS)[number]["key"]

export const REPORT_TABS = [
  { key: "sales", label: "Sales" },
  { key: "inventory", label: "Inventory" },
  { key: "staff", label: "Staff" },
  { key: "customers", label: "Customers" },
] as const

export type ReportTab = (typeof REPORT_TABS)[number]["key"]

export type ReportRange = {
  from: Date
  to: Date
  prevFrom: Date
  prevTo: Date
  custom: boolean
}

/** The UTC instant of local midnight on `ymd` ("2026-07-15") in `tz`. */
function tzMidnight(ymd: string, tz: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number)
  const off = tzOffsetMs(new Date(Date.UTC(y, mo - 1, d, 12)), tz)
  return new Date(Date.UTC(y, mo - 1, d) - off)
}

export function isYmd(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/**
 * Resolve the reporting range in the tenant's timezone, plus the immediately
 * preceding window of equal length for the "vs prev" comparison. An explicit
 * from/to pair wins over the named window; `to` is exclusive (midnight after
 * the last day) so the final day counts in full.
 */
export function resolveRange(
  window: WindowKey,
  fromParam: string | undefined,
  toParam: string | undefined,
  now: Date,
  tz: string,
): ReportRange {
  if (isYmd(fromParam) && isYmd(toParam)) {
    const from = tzMidnight(fromParam, tz)
    const to = new Date(tzMidnight(toParam, tz).getTime() + 864e5)
    const span = to.getTime() - from.getTime()
    return { from, to, prevFrom: new Date(from.getTime() - span), prevTo: from, custom: true }
  }

  const to = now
  let from: Date
  if (window === "today")
    from = tzMidnight(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now), tz)
  else if (window === "week") from = new Date(to.getTime() - 7 * 864e5)
  else if (window === "month") from = new Date(to.getTime() - 30 * 864e5)
  else if (window === "year") from = new Date(to.getTime() - 365 * 864e5)
  else from = new Date("2020-01-01T00:00:00Z")

  const span = to.getTime() - from.getTime()
  return { from, to, prevFrom: new Date(from.getTime() - span), prevTo: from, custom: false }
}

export type Delta = { dir: "up" | "down" | "new"; text: string } | null

/** Percent change vs the previous window. Null when there's nothing to compare. */
export function delta(cur: number, prev: number): Delta {
  if (prev === 0) return cur > 0 ? { dir: "new", text: "New" } : null
  const d = ((cur - prev) / prev) * 100
  if (Math.round(Math.abs(d)) === 0) return { dir: "up", text: "0%" }
  return { dir: d >= 0 ? "up" : "down", text: `${Math.abs(d).toFixed(0)}%` }
}
