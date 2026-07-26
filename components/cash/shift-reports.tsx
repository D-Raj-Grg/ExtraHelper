import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime, money } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ClosedSession } from "./types"

/**
 * Variance is `counted − expected` (see close_cash_session): negative means the
 * drawer came up short, positive means it was over. Both are worth a second
 * look, but only short is a loss — so they don't share a colour.
 */
function variance(cents: number) {
  if (cents === 0) return { label: "Balanced", tone: "text-emerald-600 dark:text-emerald-400" }
  if (cents < 0) return { label: "Short", tone: "text-destructive" }
  return { label: "Over", tone: "text-amber-600 dark:text-amber-400" }
}

function signedMoney(cents: number, currency: string) {
  return `${cents > 0 ? "+" : ""}${money(cents, currency)}`
}

export function ShiftReports({
  sessions,
  currency,
  timezone,
}: {
  sessions: ClosedSession[]
  currency: string
  timezone: string
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Shift reports</CardTitle>
        <CardDescription>The last 10 closed sessions across all cashiers.</CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No closed sessions yet. Close a drawer and its reconciliation lands here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="w-full text-sm">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="px-3 py-2 font-medium">Cashier</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Closed</TableHead>
                  <TableHead className="px-3 py-2 text-right font-medium">Float</TableHead>
                  <TableHead className="px-3 py-2 text-right font-medium">Expected</TableHead>
                  <TableHead className="px-3 py-2 text-right font-medium">Counted</TableHead>
                  <TableHead className="px-3 py-2 text-right font-medium">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => {
                  const v = variance(s.variance_cents ?? 0)
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="px-3 py-2 font-medium">{s.cashier ?? "Unknown"}</TableCell>
                      <TableCell className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {s.closed_at ? formatDateTime(s.closed_at, timezone) : "—"}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {money(s.opening_float_cents, currency)}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">
                        {money(s.expected_cents ?? 0, currency)}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">
                        {money(s.counted_cents ?? 0, currency)}
                      </TableCell>
                      <TableCell className={cn("px-3 py-2 text-right tabular-nums", v.tone)}>
                        <span className="font-medium">
                          {signedMoney(s.variance_cents ?? 0, currency)}
                        </span>
                        <span className="ml-2 text-xs opacity-80">{v.label}</span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
