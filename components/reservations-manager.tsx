"use client"

import { useActionState, useTransition } from "react"
import {
  createReservation,
  setReservationStatus,
  type ResvState,
} from "@/app/(app)/reservations/actions"
import { type ResvStatus } from "@/lib/reservation-constants"
import { formatDateTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"

type Table = { id: string; label: string; capacity: number }
type Reservation = {
  id: string
  party_size: number
  reserved_at: string
  status: string
  notes: string | null
  customers: { name: string | null; phone: string | null } | null
  restaurant_tables: { label: string } | null
}

const inputClass =
  "border-input dark:bg-input/30 h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  confirmed: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  seated: "bg-green-500/10 text-green-600 dark:text-green-400",
  cancelled: "bg-muted text-muted-foreground",
  no_show: "bg-red-500/10 text-red-600 dark:text-red-400",
}

// Which status actions to offer from a given state.
const NEXT: Record<string, { label: string; status: ResvStatus }[]> = {
  pending: [
    { label: "Confirm", status: "confirmed" },
    { label: "Cancel", status: "cancelled" },
  ],
  confirmed: [
    { label: "Seat", status: "seated" },
    { label: "No-show", status: "no_show" },
    { label: "Cancel", status: "cancelled" },
  ],
  seated: [],
  cancelled: [],
  no_show: [],
}

export function ReservationsManager({
  reservations,
  tables,
  timezone,
}: {
  reservations: Reservation[]
  tables: Table[]
  timezone: string
}) {
  const [state, formAction, pending] = useActionState<ResvState, FormData>(
    createReservation,
    undefined,
  )
  const [busy, startTransition] = useTransition()

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-2 text-lg font-semibold">New reservation</h2>
        <form action={formAction} className="flex flex-wrap items-end gap-2">
          <Input name="name" placeholder="Guest name" className="max-w-40" required />
          <Input name="phone" placeholder="Phone" className="w-32" />
          <Input name="party" type="number" min={1} defaultValue={2} className="w-20" required />
          <input name="when" type="datetime-local" className={inputClass} required />
          <Select name="tableId" defaultValue="">
            <SelectTrigger className="w-full">
              <SelectValue placeholder="— table —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">— table —</SelectItem>
              {tables.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label} ({t.capacity})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "…" : "Book"}
          </Button>
          {state && "error" in state ? (
            <p className="w-full text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
        </form>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Upcoming</h2>
        {reservations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reservations.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="w-full text-sm">
              <TableHeader className="bg-muted/50 text-left">
                <TableRow>
                  <TableHead className="px-3 py-2 font-medium">When</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Guest</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Party</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Table</TableHead>
                  <TableHead className="px-3 py-2 font-medium">Status</TableHead>
                  <TableHead className="px-3 py-2 font-medium text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reservations.map((r) => (
                  <TableRow key={r.id} className="border-t">
                    <TableCell className="px-3 py-2 text-muted-foreground">
                      {formatDateTime(r.reserved_at, timezone)}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      {r.customers?.name ?? "Guest"}
                      {r.customers?.phone ? (
                        <span className="block text-xs text-muted-foreground">
                          {r.customers.phone}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-muted-foreground">{r.party_size}</TableCell>
                    <TableCell className="px-3 py-2 text-muted-foreground">
                      {r.restaurant_tables?.label ?? "—"}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[r.status] ?? STATUS_STYLES.cancelled
                        }`}
                      >
                        {r.status.replace("_", " ")}
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {(NEXT[r.status] ?? []).map((a) => (
                          <Button
                            key={a.status}
                            size="sm"
                            variant={a.status === "cancelled" || a.status === "no_show" ? "outline" : "default"}
                            disabled={busy}
                            onClick={() =>
                              startTransition(async () => {
                                await setReservationStatus(r.id, a.status)
                              })
                            }
                          >
                            {a.label}
                          </Button>
                        ))}
                      </div>
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
