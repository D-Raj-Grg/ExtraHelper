"use client"

import { useActionState, useState, useTransition } from "react"
import { PlusIcon } from "lucide-react"
import { createStation, deleteStation, updateStation } from "@/app/(app)/menu/actions"
import type { MenuState } from "@/app/(app)/menu/actions"
import { setStationKind, setStationPrinter } from "@/app/(app)/settings/printers-actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FormError, InlineError, type Station, type StationPrinter } from "./types"

/** base-ui rejects an empty Select value, so "no printer" needs a sentinel. */
const DEFAULT_PRINTER = "__default__"

export function StationsTab({
  stations,
  printers,
}: {
  stations: Station[]
  printers: StationPrinter[]
}) {
  const [state, action, pending] = useActionState<MenuState, FormData>(createStation, undefined)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Kitchen stations</h2>
        <p className="text-sm text-muted-foreground">
          Kitchen sections like Grill, Bar or Tandoor. An item&apos;s ticket (KOT) prints at the
          stations it&apos;s routed to — each on its own printer.
        </p>
      </div>

      {stations.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">No stations yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add one below, then route menu items to it. Tickets split by station so the grill
              and the bar each get their own.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Station</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Printer</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stations.map((s) => (
                  <StationRow key={s.id} station={s} printers={printers} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="station-name">New station</Label>
          <Input id="station-name" name="name" placeholder="e.g. Grill" className="w-56" required />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          <PlusIcon />
          {pending ? "Adding…" : "Add station"}
        </Button>
        <FormError state={state} />
      </form>
    </div>
  )
}

function StationRow({
  station,
  printers,
}: {
  station: Station
  printers: StationPrinter[]
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(station.name)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function routeTo(value: string) {
    startTransition(async () => {
      const res = await setStationPrinter(
        station.id,
        value === DEFAULT_PRINTER ? null : value,
      )
      if (res && "error" in res) setErr(res.error)
      else setErr(null)
    })
  }

  function setKind(kind: "kitchen" | "bar") {
    startTransition(async () => {
      const res = await setStationKind(station.id, kind)
      if (res && "error" in res) setErr(res.error)
      else setErr(null)
    })
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        {editing ? (
          <Field>
            <FieldLabel htmlFor={`station-edit-${station.id}`} className="sr-only">
              Station name
            </FieldLabel>
            <Input
              id={`station-edit-${station.id}`}
              className="w-40"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
        ) : (
          station.name
        )}
      </TableCell>

      <TableCell>
        <Field>
          <FieldLabel htmlFor={`station-kind-${station.id}`} className="sr-only">
            Ticket type for {station.name}
          </FieldLabel>
          <Select
            value={station.kind}
            onValueChange={(v) => setKind(String(v ?? "kitchen") as "kitchen" | "bar")}
          >
            <SelectTrigger id={`station-kind-${station.id}`} className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="kitchen">Kitchen (KOT)</SelectItem>
              <SelectItem value="bar">Bar (BOT)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </TableCell>

      <TableCell>
        <Field>
          <FieldLabel htmlFor={`station-printer-${station.id}`} className="sr-only">
            Printer for {station.name}
          </FieldLabel>
          <Select
            value={station.printer_id ?? DEFAULT_PRINTER}
            onValueChange={(v) => routeTo(String(v ?? DEFAULT_PRINTER))}
          >
            <SelectTrigger id={`station-printer-${station.id}`} className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_PRINTER}>Default kitchen printer</SelectItem>
              {printers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </TableCell>

      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          {editing ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await updateStation(station.id, name)
                    if (res && "error" in res) setErr(res.error)
                    else setEditing(false)
                  })
                }
              >
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false)
                  setName(station.name)
                  setErr(null)
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`Rename ${station.name}`}
                onClick={() => setEditing(true)}
              >
                Rename
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={pending}
                aria-label={`Delete ${station.name}`}
                onClick={() =>
                  startTransition(async () => {
                    const res = await deleteStation(station.id)
                    if (res && "error" in res) setErr(res.error)
                  })
                }
              >
                Delete
              </Button>
            </>
          )}
        </div>
        <InlineError msg={err} />
      </TableCell>
    </TableRow>
  )
}
