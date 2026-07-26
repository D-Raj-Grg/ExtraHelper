"use client"

import { useActionState } from "react"
import { closeSession, openSession, type CashState } from "@/app/(app)/cash/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { formatDateTime, money } from "@/lib/format"
import type { OpenSession } from "./types"

function FormError({ state }: { state: CashState }) {
  if (state && "error" in state)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    )
  return null
}

export function SessionCard({
  currency,
  timezone,
  openSessionRow,
}: {
  currency: string
  timezone: string
  openSessionRow: OpenSession | null
}) {
  return openSessionRow ? (
    <CloseCard currency={currency} timezone={timezone} session={openSessionRow} />
  ) : (
    <OpenCard currency={currency} />
  )
}

function OpenCard({ currency }: { currency: string }) {
  const [state, action, pending] = useActionState<CashState, FormData>(openSession, undefined)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open a session</CardTitle>
        <CardDescription>
          Count the cash you start the shift with. Every cash payment after this is reconciled
          against it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="float">Opening float ({currency})</FieldLabel>
            <Input
              id="float"
              name="float"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              defaultValue={0}
              required
              className="tabular-nums"
            />
            <FieldDescription>The float already in the drawer before any sales.</FieldDescription>
          </Field>
          <FormError state={state} />
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Opening…" : "Open drawer"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function CloseCard({
  currency,
  timezone,
  session,
}: {
  currency: string
  timezone: string
  session: OpenSession
}) {
  const [state, action, pending] = useActionState<CashState, FormData>(closeSession, undefined)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open session</CardTitle>
        <CardDescription>
          Opened {formatDateTime(session.opened_at, timezone)} with a{" "}
          {money(session.opening_float_cents, currency)} float.
        </CardDescription>
        <CardAction>
          <Badge variant="secondary">Open</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="sessionId" value={session.id} />
          <Field>
            <FieldLabel htmlFor="counted">Counted cash ({currency})</FieldLabel>
            <Input
              id="counted"
              name="counted"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              required
              className="tabular-nums"
            />
            <FieldDescription>
              Everything in the drawer, float included. The expected total is only worked out after
              you submit, so the count stays honest.
            </FieldDescription>
          </Field>
          <FormError state={state} />
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Closing…" : "Close & reconcile"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
