import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DayPicker } from "@/components/reports/day-picker"
import {
  PAID_FROM,
  PAID_FROM_LABELS,
  type ExpenseCategory,
  type ExpenseRow,
} from "@/lib/expense-constants"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ExpenseForm } from "./expense-form"
import { ExpenseList } from "./expense-list"

/**
 * Quick-add on the left, the day on the right. Totals ignore voided rows, the
 * same rule daily_report applies, so this card and Day close always agree.
 */
export function ExpensesBoard({
  date,
  today,
  currency,
  timezone,
  categories,
  expenses,
  canBackdate,
  canViewAll,
  canCloseDay,
}: {
  date: string
  today: string
  currency: string
  timezone: string
  categories: ExpenseCategory[]
  expenses: ExpenseRow[]
  canBackdate: boolean
  canViewAll: boolean
  canCloseDay: boolean
}) {
  const live = expenses.filter((e) => !e.voided)
  const total = live.reduce((s, e) => s + e.amount_cents, 0)
  const byFrom = Object.fromEntries(
    PAID_FROM.map((p) => [
      p,
      live.filter((e) => e.paid_from === p).reduce((s, e) => s + e.amount_cents, 0),
    ]),
  ) as Record<(typeof PAID_FROM)[number], number>
  const catTotals = new Map<string, number>()
  for (const e of live) catTotals.set(e.category, (catTotals.get(e.category) ?? 0) + e.amount_cents)
  const byCategory = [...catTotals]
    .map(([name, cents]) => ({ name, cents }))
    .sort((a, b) => b.cents - a.cents)

  return (
    <>
      <DayPicker date={date} today={today} basePath="/expenses" />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <ExpenseForm
          key={date}
          date={date}
          today={today}
          currency={currency}
          categories={categories}
          canBackdate={canBackdate}
        />

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {canViewAll ? "Spent this day" : "You logged this day"}
                </CardTitle>
                <p className="mt-1 text-3xl font-bold tabular-nums">{money(total, currency)}</p>
                <p className="text-sm text-muted-foreground">
                  {live.length} {live.length === 1 ? "entry" : "entries"}
                </p>
              </div>
              {canCloseDay ? (
                <Link
                  href={`/reports/day?date=${date}`}
                  className={cn(buttonVariants({ variant: "outline" }), "h-11")}
                >
                  Count cash on Day close
                  <ArrowRightIcon className="size-4" />
                </Link>
              ) : null}
            </CardHeader>
            {live.length > 0 ? (
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <dl className="space-y-1 text-sm">
                  {PAID_FROM.map((p) => (
                    <div key={p} className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">{PAID_FROM_LABELS[p]}</dt>
                      <dd className="tabular-nums">{money(byFrom[p], currency)}</dd>
                    </div>
                  ))}
                </dl>
                <dl className="space-y-1 text-sm">
                  {byCategory.map((c) => (
                    <div key={c.name} className="flex justify-between gap-4">
                      <dt className="truncate text-muted-foreground">{c.name}</dt>
                      <dd className="tabular-nums">{money(c.cents, currency)}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            ) : null}
          </Card>

          <ExpenseList
            expenses={expenses}
            categories={categories}
            currency={currency}
            timezone={timezone}
            showBy={canViewAll}
          />
        </div>
      </div>
    </>
  )
}
