"use client"

import { useEffect, useState } from "react"

import { formatDateTime } from "@/lib/format"

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
]

// Locale pinned for the same reason money() pins it: the runtime default
// differs between server and client and the mismatch shows up as a hydration
// error rather than anything obvious.
const RTF = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" })

function relative(iso: string, now: number): string {
  let value = (new Date(iso).getTime() - now) / 1000
  for (const [unit, span] of UNITS) {
    if (Math.abs(value) < span) return RTF.format(Math.round(value), unit)
    value /= span
  }
  return RTF.format(Math.round(value), "week")
}

/**
 * "5 minutes ago", but hydration-safe.
 *
 * A relative string can't be rendered on the server: it's computed from the
 * clock, so the server's "5 minutes ago" and the client's "6 minutes ago" a
 * moment later are a hydration mismatch. So the first paint is the absolute
 * time — deterministic — and it swaps to relative once mounted. The absolute
 * form stays in the tooltip either way.
 */
export function RelativeTime({ iso, timeZone }: { iso: string; timeZone: string }) {
  const absolute = formatDateTime(iso, timeZone)
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    const tick = () => setText(relative(iso, Date.now()))
    tick()
    const timer = setInterval(tick, 30_000)
    return () => clearInterval(timer)
  }, [iso])

  return (
    <time dateTime={iso} title={absolute}>
      {text ?? absolute}
    </time>
  )
}
