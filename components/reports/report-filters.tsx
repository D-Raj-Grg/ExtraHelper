import Link from "next/link"
import { Button, buttonVariants } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { REPORT_TABS, WINDOWS, type ReportTab, type WindowKey } from "@/lib/report-range"

/**
 * Tab + range navigation. These are links, not client tabs: each tab fetches
 * its own data on the server and the URL stays shareable.
 */
export function ReportFilters({
  tab,
  window,
  custom,
  from,
  to,
}: {
  tab: ReportTab
  window: WindowKey
  custom: boolean
  from: string | undefined
  to: string | undefined
}) {
  const rangeQs = custom ? `from=${from}&to=${to}` : `window=${window}`

  return (
    <div className="mb-6 flex flex-col gap-4 print:hidden">
      <nav aria-label="Report" className="flex flex-wrap gap-1 border-b">
        {REPORT_TABS.map((t) => (
          <Link
            key={t.key}
            href={`/reports?tab=${t.key}&${rangeQs}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              t.key === tab
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <nav aria-label="Date range" className="flex flex-wrap gap-2">
          {WINDOWS.map((x) => {
            const active = !custom && x.key === window
            return (
              <Link
                key={x.key}
                href={`/reports?tab=${tab}&window=${x.key}`}
                aria-current={active ? "true" : undefined}
                className={cn(
                  buttonVariants({ variant: active ? "default" : "outline", size: "sm" }),
                  "rounded-full",
                )}
              >
                {x.label}
              </Link>
            )
          })}
        </nav>

        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value={tab} />
          <Field className="w-auto gap-1">
            <FieldLabel htmlFor="from" className="text-xs text-muted-foreground">
              From
            </FieldLabel>
            <Input
              id="from"
              type="date"
              name="from"
              defaultValue={custom ? from : ""}
              className="h-9 w-auto"
            />
          </Field>
          <Field className="w-auto gap-1">
            <FieldLabel htmlFor="to" className="text-xs text-muted-foreground">
              To
            </FieldLabel>
            <Input
              id="to"
              type="date"
              name="to"
              defaultValue={custom ? to : ""}
              className="h-9 w-auto"
            />
          </Field>
          <Button type="submit" size="sm">
            Apply range
          </Button>
          {custom ? (
            <Link
              href={`/reports?tab=${tab}&window=today`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Clear
            </Link>
          ) : null}
        </form>
      </div>
    </div>
  )
}
