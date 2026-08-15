import { AlertCircleIcon, CheckCircle2Icon, TruckIcon, WalletIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { money } from "@/lib/format"
import type { PurchasingSummary } from "./types"

/**
 * Three readouts, not filters — so a plain div, no button, no aria-pressed.
 *
 * Each tone carries an icon and a word as well as a hue: a kitchen is lit badly
 * and staff are colourblind at the same rate as everyone else.
 */
export function SummaryStrip({
  summary,
  currency,
  timezone,
}: {
  summary: PurchasingSummary | null
  currency: string
  timezone: string
}) {
  if (!summary) return null

  const owed = Number(summary.owed_cents)
  const monthLabel = summary.month_start
    ? new Intl.DateTimeFormat(undefined, { month: "long", timeZone: timezone }).format(
        new Date(summary.month_start),
      )
    : "this month"

  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-3">
      <Card className="gap-1 p-4">
        <p className="text-sm text-muted-foreground">You owe</p>
        <p className="text-2xl font-semibold tabular-nums">{money(owed, currency)}</p>
        {owed > 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
            <AlertCircleIcon className="size-4" />
            across {summary.owed_suppliers}{" "}
            {summary.owed_suppliers === 1 ? "supplier" : "suppliers"}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2Icon className="size-4" />
            Every supplier settled
          </p>
        )}
      </Card>

      <Card className="gap-1 p-4">
        <p className="text-sm text-muted-foreground">Open orders</p>
        <p className="text-2xl font-semibold tabular-nums">{summary.open_pos}</p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <TruckIcon className="size-4" />
          {summary.awaiting_delivery} awaiting delivery
        </p>
      </Card>

      <Card className="gap-1 p-4">
        <p className="text-sm text-muted-foreground">Spent in {monthLabel}</p>
        <p className="text-2xl font-semibold tabular-nums">
          {money(Number(summary.month_spend_cents), currency)}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <WalletIcon className="size-4" />
          Payments recorded
        </p>
      </Card>
    </div>
  )
}
