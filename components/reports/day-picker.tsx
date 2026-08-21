import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { shiftDay } from "./day-report"

/**
 * Prev / pick / next for the day-close sheet.
 *
 * Links and a GET form rather than client state, the same way ReportFilters
 * works: each day fetches on the server and the URL stays shareable. Hidden in
 * print — the paper is of one day and has no controls to offer.
 */
export function DayPicker({ date, today }: { date: string; today: string }) {
  const isToday = date >= today

  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 print:hidden">
      <div className="flex items-end gap-2">
        <Link
          href={`/reports/day?date=${shiftDay(date, -1)}`}
          aria-label="Previous day"
          className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-11")}
        >
          <ChevronLeftIcon />
        </Link>
        <form method="get" className="flex items-end gap-2">
          <Field className="w-auto gap-1">
            <FieldLabel htmlFor="date" className="text-xs text-muted-foreground">
              Business day
            </FieldLabel>
            <Input
              id="date"
              type="date"
              name="date"
              defaultValue={date}
              max={today}
              className="h-11 w-auto"
            />
          </Field>
          <Button type="submit" className="h-11">
            Show
          </Button>
        </form>
        {isToday ? (
          <span
            aria-label="Next day"
            aria-disabled="true"
            className={cn(
              buttonVariants({ variant: "outline", size: "icon" }),
              "size-11 pointer-events-none opacity-50",
            )}
          >
            <ChevronRightIcon />
          </span>
        ) : (
          <Link
            href={`/reports/day?date=${shiftDay(date, 1)}`}
            aria-label="Next day"
            className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-11")}
          >
            <ChevronRightIcon />
          </Link>
        )}
      </div>

      <div className="flex items-end gap-2">
        {isToday ? null : (
          <Link href="/reports/day" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Today
          </Link>
        )}
        <Link href="/reports" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          All reports
        </Link>
      </div>
    </div>
  )
}
