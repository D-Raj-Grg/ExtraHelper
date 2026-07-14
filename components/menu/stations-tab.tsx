"use client"

import { useActionState, useState, useTransition } from "react"
import { createStation, deleteStation, updateStation } from "@/app/(app)/menu/actions"
import type { MenuState } from "@/app/(app)/menu/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormError, InlineError, type Station } from "./types"

export function StationsTab({ stations }: { stations: Station[] }) {
  const [state, action, pending] = useActionState<MenuState, FormData>(createStation, undefined)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Kitchen stations</h2>
        <p className="text-sm text-muted-foreground">
          Kitchen sections like Grill, Bar or Tandoor. An item&apos;s ticket (KOT) prints at the stations it&apos;s routed to.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {stations.length === 0 ? (
          <span className="text-sm text-muted-foreground">No stations yet — add one to route kitchen tickets.</span>
        ) : (
          stations.map((s) => <StationPill key={s.id} station={s} />)
        )}
      </div>

      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="station-name">New station</Label>
          <Input id="station-name" name="name" placeholder="e.g. Grill" className="w-56" required />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Adding…" : "Add station"}
        </Button>
        <FormError state={state} />
      </form>
    </div>
  )
}

function StationPill({ station }: { station: Station }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(station.name)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
        <Label htmlFor={`station-edit-${station.id}`} className="sr-only">
          Station name
        </Label>
        <Input
          id={`station-edit-${station.id}`}
          className="h-7 w-32"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <Button
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
          size="sm"
          variant="link"
          onClick={() => {
            setEditing(false)
            setName(station.name)
            setErr(null)
          }}
        >
          Cancel
        </Button>
        <InlineError msg={err} />
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm font-medium">
      {station.name}
      <Button size="sm" variant="link" aria-label={`Rename ${station.name}`} onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button
        size="sm"
        variant="link"
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
      <InlineError msg={err} />
    </span>
  )
}
