"use client"

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react"
import {
  ArmchairIcon,
  CalendarPlusIcon,
  CheckCircle2Icon,
  ClockIcon,
  TriangleAlertIcon,
  UserRoundXIcon,
  UsersRoundIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  createReservation,
  setReservationStatus,
  type ResvState,
} from "@/app/(app)/reservations/actions"
import { resvStatusLabel, type ResvStatus } from "@/lib/reservation-constants"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

type DiningTable = { id: string; label: string; capacity: number }
type Reservation = {
  id: string
  party_size: number
  reserved_at: string
  status: string
  notes: string | null
  customers: { name: string | null; phone: string | null } | null
  restaurant_tables: { label: string } | null
}

/** Status carries an icon + label + semantic colour — never colour alone. */
const STATUS: Record<string, { className: string; icon: LucideIcon }> = {
  pending: { className: "bg-amber-500/10 text-amber-700 dark:text-amber-400", icon: ClockIcon },
  confirmed: {
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    icon: CheckCircle2Icon,
  },
  seated: {
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    icon: ArmchairIcon,
  },
  cancelled: { className: "bg-muted text-muted-foreground", icon: XCircleIcon },
  no_show: { className: "bg-destructive/10 text-destructive", icon: UserRoundXIcon },
}

/**
 * Which status actions to offer from a given state, and what confirming one
 * actually costs the guest — a cancel or a no-show is not undoable from here,
 * so both go through a dialog that names the consequence.
 */
type Action = {
  label: string
  status: ResvStatus
  variant?: "default" | "outline" | "destructive"
  confirm?: { title: (name: string) => string; body: string; action: string }
}

const NEXT: Record<string, Action[]> = {
  pending: [
    { label: "Confirm", status: "confirmed" },
    {
      label: "Cancel",
      status: "cancelled",
      variant: "outline",
      confirm: {
        title: (name) => `Cancel ${name}'s booking?`,
        body: "The table is released for other bookings and this reservation drops off the board. You'd have to book it again from scratch.",
        action: "Cancel booking",
      },
    },
  ],
  confirmed: [
    { label: "Seat", status: "seated" },
    {
      label: "No-show",
      status: "no_show",
      variant: "outline",
      confirm: {
        title: (name) => `Mark ${name} as a no-show?`,
        body: "This records that the guest never arrived and frees the table. It stays on the guest's history.",
        action: "Mark no-show",
      },
    },
    {
      label: "Cancel",
      status: "cancelled",
      variant: "outline",
      confirm: {
        title: (name) => `Cancel ${name}'s booking?`,
        body: "The table is released for other bookings and this reservation drops off the board. You'd have to book it again from scratch.",
        action: "Cancel booking",
      },
    },
  ],
  seated: [],
  cancelled: [],
  no_show: [],
}

/** Past this point a booking is no longer worth chasing on the board. */
const CLOSED = new Set(["seated", "cancelled", "no_show"])

/** Sortable day key ("2026-08-15") in the tenant's timezone, not the browser's. */
function dayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(new Date(iso))
}

function dayLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(iso))
}

const MINUTE = 60_000

function subscribeMinute(onChange: () => void): () => void {
  const t = setInterval(onChange, MINUTE)
  return () => clearInterval(t)
}

/** Now, rounded down to the minute — a stable snapshot between ticks. */
function minuteNow(): number {
  return Math.floor(Date.now() / MINUTE) * MINUTE
}

function timeLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, timeStyle: "short" }).format(new Date(iso))
}

export function ReservationsManager({
  reservations,
  tables,
  timezone,
}: {
  reservations: Reservation[]
  tables: DiningTable[]
  timezone: string
}) {
  const [state, formAction, pending] = useActionState<ResvState, FormData>(
    createReservation,
    undefined,
  )
  // The booked form is remounted rather than reset: form.reset() clears the
  // plain inputs but not Base UI's Select, which would keep the last table
  // selected on the next guest. The id of the booking just made is the key —
  // and a rejected booking remounts too, refilled from the draft it echoed.
  const formKey = state && "ok" in state ? (state.id ?? "booked") : "new"
  const draft = state && "error" in state ? state.draft : null

  // Clock for "Today" and the overdue marker. Null on the server: it has no
  // business guessing the host's wall clock, and rendering one hydrates
  // mismatched. Snapshot is minute-bucketed so it's stable between ticks.
  const now = useSyncExternalStore<number | null>(subscribeMinute, minuteNow, () => null)

  useEffect(() => {
    if (!state) return
    if ("ok" in state) {
      toast.success("Reservation booked")
    }
  }, [state])

  const days = useMemo(() => {
    const byDay = new Map<string, Reservation[]>()
    for (const r of reservations) {
      const key = dayKey(r.reserved_at, timezone)
      const bucket = byDay.get(key)
      if (bucket) bucket.push(r)
      else byDay.set(key, [r])
    }
    return [...byDay.entries()].map(([key, rows]) => ({
      key,
      label: dayLabel(rows[0].reserved_at, timezone),
      covers: rows.reduce((n, r) => (CLOSED.has(r.status) ? n : n + r.party_size), 0),
      rows,
    }))
  }, [reservations, timezone])

  const todayKey = now === null ? null : dayKey(new Date(now).toISOString(), timezone)

  return (
    <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
      <Card className="order-1 lg:sticky lg:top-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarPlusIcon className="size-4 text-muted-foreground" aria-hidden />
            New reservation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form key={formKey} action={formAction}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="resv-name">Guest name</FieldLabel>
                <Input
                  id="resv-name"
                  name="name"
                  placeholder="e.g. Anita Shrestha"
                  defaultValue={draft?.name}
                  required
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="resv-phone">Phone</FieldLabel>
                  <Input
                    id="resv-phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    defaultValue={draft?.phone}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="resv-party">Guests</FieldLabel>
                  <Input
                    id="resv-party"
                    name="party"
                    type="number"
                    min={1}
                    defaultValue={draft?.party ?? 2}
                    className="tabular-nums"
                    required
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="resv-when">Date and time</FieldLabel>
                <Input
                  id="resv-when"
                  name="when"
                  type="datetime-local"
                  defaultValue={draft?.when}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="resv-table">Table</FieldLabel>
                <Select name="tableId" defaultValue={draft?.tableId ?? ""}>
                  <SelectTrigger id="resv-table" className="w-full">
                    <SelectValue placeholder="Any table" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Any table</SelectItem>
                    {tables.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label} · seats {t.capacity}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="resv-notes">Notes</FieldLabel>
                <Input
                  id="resv-notes"
                  name="notes"
                  placeholder="Birthday, high chair, window seat…"
                  defaultValue={draft?.notes}
                />
              </Field>
              {state && "error" in state ? (
                <p className="text-sm text-destructive" role="alert">
                  {state.error}
                </p>
              ) : null}
              <Button type="submit" size="lg" disabled={pending} className="h-11 w-full">
                {pending ? "Booking…" : "Book table"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <div className="order-2 flex flex-col gap-6 lg:col-span-2">
        {days.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
            <UsersRoundIcon className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-base font-semibold">No tables booked yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Take the guest&apos;s name, party size and time on the left and it lands here — one
              card per service day, ready to confirm and seat.
            </p>
          </div>
        ) : (
          days.map((day) => (
            <Card key={day.key}>
              <CardHeader>
                <CardTitle className="flex items-baseline gap-2">
                  {day.key === todayKey ? "Today" : day.label}
                  {day.key === todayKey ? (
                    <span className="text-sm font-normal text-muted-foreground">{day.label}</span>
                  ) : null}
                </CardTitle>
                <CardAction className="text-sm text-muted-foreground tabular-nums">
                  {day.covers} {day.covers === 1 ? "cover" : "covers"}
                </CardAction>
              </CardHeader>
              <CardContent className="overflow-x-auto px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28 pl-6">Time</TableHead>
                      <TableHead>Guest</TableHead>
                      <TableHead className="w-20 text-right">Party</TableHead>
                      <TableHead className="w-20">Table</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead className="pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {day.rows.map((r) => (
                      <ReservationRow
                        key={r.id}
                        reservation={r}
                        timezone={timezone}
                        late={
                          now !== null &&
                          !CLOSED.has(r.status) &&
                          new Date(r.reserved_at).getTime() < now
                        }
                      />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}

function ReservationRow({
  reservation: r,
  timezone,
  late,
}: {
  reservation: Reservation
  timezone: string
  late: boolean
}) {
  const [busy, startTransition] = useTransition()
  const guest = r.customers?.name?.trim() || "Guest"

  const run = (status: ResvStatus, done: string) =>
    startTransition(async () => {
      const result = await setReservationStatus(r.id, status)
      if (result && "error" in result) toast.error(result.error)
      else toast.success(done)
    })

  return (
    <TableRow className={cn(busy && "opacity-60")}>
      <TableCell className="pl-6 font-medium tabular-nums">
        {timeLabel(r.reserved_at, timezone)}
        {late ? (
          <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon className="size-3" aria-hidden />
            Overdue
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        <span className="block truncate font-medium">{guest}</span>
        {r.customers?.phone ? (
          <a
            href={`tel:${r.customers.phone}`}
            className="block text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            {r.customers.phone}
          </a>
        ) : null}
        {r.notes ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">{r.notes}</span>
        ) : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">{r.party_size}</TableCell>
      <TableCell className="text-muted-foreground">
        {r.restaurant_tables?.label ?? "Any"}
      </TableCell>
      <TableCell>
        <StatusBadge status={r.status} />
      </TableCell>
      <TableCell className="pr-6">
        <div className="flex flex-nowrap justify-end gap-2">
          {(NEXT[r.status] ?? []).map((a) =>
            a.confirm ? (
              <ConfirmAction
                key={a.status}
                action={a}
                guest={guest}
                busy={busy}
                onConfirm={() => run(a.status, `${guest} — ${resvStatusLabel(a.status)}`)}
              />
            ) : (
              <Button
                key={a.status}
                size="lg"
                className="h-11"
                variant={a.variant ?? "default"}
                disabled={busy}
                onClick={() => run(a.status, `${guest} — ${resvStatusLabel(a.status)}`)}
              >
                {a.label}
              </Button>
            ),
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function ConfirmAction({
  action,
  guest,
  busy,
  onConfirm,
}: {
  action: Action
  guest: string
  busy: boolean
  onConfirm: () => void
}) {
  // Controlled: AlertDialogAction is a plain Button here, so confirming has to
  // close the dialog itself.
  const [open, setOpen] = useState(false)
  const confirm = action.confirm!

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button size="lg" className="h-11" variant={action.variant ?? "outline"} disabled={busy}>
            {action.label}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm.title(guest)}</AlertDialogTitle>
          <AlertDialogDescription>{confirm.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep booking</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            {confirm.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.pending
  const Icon = s.icon
  return (
    <Badge className={cn("gap-1", s.className)}>
      <Icon className="size-3.5" aria-hidden />
      {resvStatusLabel(status)}
    </Badge>
  )
}
