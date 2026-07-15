"use client"

import { useActionState } from "react"
import { PlusIcon } from "lucide-react"
import { createFloor, createTable, type TablesState } from "@/app/(app)/tables/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Floor } from "./types"

function FormError({ state }: { state: TablesState }) {
  if (state && "error" in state)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    )
  return null
}

export function AddForms({ floors }: { floors: Floor[] }) {
  const [floorState, floorAction, floorPending] = useActionState<TablesState, FormData>(
    createFloor,
    undefined,
  )
  const [tableState, tableAction, tablePending] = useActionState<TablesState, FormData>(
    createTable,
    undefined,
  )

  return (
    <section className="grid items-start gap-4 lg:grid-cols-2">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Add floor</CardTitle>
          <CardDescription>Group tables by area — Ground, Terrace, Garden.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={floorAction} className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Field className="flex-1">
                <FieldLabel htmlFor="floor-name" className="sr-only">
                  Floor name
                </FieldLabel>
                <Input id="floor-name" name="name" placeholder="e.g. Ground Floor" required />
              </Field>
              <Button type="submit" variant="secondary" disabled={floorPending}>
                <PlusIcon className="size-4" />
                {floorPending ? "Adding…" : "Add"}
              </Button>
            </div>
            <FormError state={floorState} />
          </form>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Add table</CardTitle>
          <CardDescription>Each table gets its own dine-in QR automatically.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={tableAction} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end gap-2">
              <Field className="w-20">
                <FieldLabel htmlFor="table-label">Label</FieldLabel>
                <Input id="table-label" name="label" placeholder="T1" required />
              </Field>
              <Field className="w-24">
                <FieldLabel htmlFor="table-capacity">Seats</FieldLabel>
                <Input
                  id="table-capacity"
                  name="capacity"
                  type="number"
                  min={1}
                  defaultValue={4}
                  required
                  className="tabular-nums"
                />
              </Field>
              <Field className="min-w-32 flex-1">
                <FieldLabel htmlFor="table-floor">Floor</FieldLabel>
                <Select name="floorId" defaultValue="">
                  <SelectTrigger id="table-floor" className="w-full">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Unassigned</SelectItem>
                    {floors.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button type="submit" disabled={tablePending}>
                <PlusIcon className="size-4" />
                {tablePending ? "Adding…" : "Add"}
              </Button>
            </div>
            <FormError state={tableState} />
          </form>
        </CardContent>
      </Card>
    </section>
  )
}
