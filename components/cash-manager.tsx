"use client"

import { useActionState } from "react"
import { closeSession, openSession, type CashState } from "@/app/(app)/cash/actions"
import { formatDateTime, money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"

type OpenSession = { id: string; opening_float_cents: number; opened_at: string }
type ClosedSession = {
  id: string
  opening_float_cents: number
  expected_cents: number | null
  counted_cents: number | null
  variance_cents: number | null
  opened_at: string
  closed_at: string | null
}

function FormError({ state }: { state: CashState }) {
  if (state && "error" in state)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    )
  return null
}

export function CashManager({
  currency,
  timezone,
  openSessionRow,
  closedSessions,
}: {
  currency: string
  timezone: string
  openSessionRow: OpenSession | null
  closedSessions: ClosedSession[]
}) {
  const [openState, openAction, openPending] = useActionState<CashState, FormData>(
    openSession,
    undefined,
  )
  const [closeState, closeAction, closePending] = useActionState<CashState, FormData>(
    closeSession,
    undefined,
  )

  return (
    <div className="flex flex-col gap-8">
      {openSessionRow ? (
        <section className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Open session</h2>
            <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
              open
            </span>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Opening float {money(openSessionRow.opening_float_cents, currency)} ·
            since {formatDateTime(openSessionRow.opened_at, timezone)}
          </p>
          <form action={closeAction} className="flex flex-col gap-3">
            <input type="hidden" name="sessionId" value={openSessionRow.id} />
            <Field>
              <FieldLabel htmlFor="counted">Counted cash</FieldLabel>
              <Input id="counted" name="counted" type="number" min={0} step="0.01" required />
            </Field>
            <FormError state={closeState} />
            <Button type="submit" disabled={closePending}>
              {closePending ? "Closing…" : "Close & reconcile"}
            </Button>
          </form>
        </section>
      ) : (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-semibold">Open a session</h2>
          <form action={openAction} className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="float">Opening float</FieldLabel>
              <Input id="float" name="float" type="number" min={0} step="0.01" defaultValue={0} required />
            </Field>
            <FormError state={openState} />
            <Button type="submit" disabled={openPending}>
              {openPending ? "Opening…" : "Open drawer"}
            </Button>
          </form>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">Shift reports</h2>
        {closedSessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No closed sessions yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="w-full text-sm">
              <TableHeader className="bg-muted/50 text-left">
                <TableRow>
                  <TableHead className="px-3 py-2 font-medium">Closed</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Float</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Expected</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Counted</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closedSessions.map((s) => (
                  <TableRow key={s.id} className="border-t">
                    <TableCell className="px-3 py-2 text-muted-foreground">
                      {s.closed_at ? formatDateTime(s.closed_at, timezone) : "—"}
                    </TableCell>
                    <TableCell className="px-3 py-2">{money(s.opening_float_cents, currency)}</TableCell>
                    <TableCell className="px-3 py-2">{money(s.expected_cents ?? 0, currency)}</TableCell>
                    <TableCell className="px-3 py-2">{money(s.counted_cents ?? 0, currency)}</TableCell>
                    <TableCell
                      className={`px-3 py-2 font-medium ${
                        (s.variance_cents ?? 0) === 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {money(s.variance_cents ?? 0, currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}
