"use client"

import { useActionState } from "react"
import { bookPublic, type BookState } from "@/app/book/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"

const inputClass =
  "border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"

export function BookForm({ slug, timezone }: { slug: string; timezone: string }) {
  const action = bookPublic.bind(null, slug)
  const [state, formAction, pending] = useActionState<BookState, FormData>(action, undefined)

  if (state && "ok" in state) {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-6 text-center">
        <p className="text-lg font-semibold text-green-600 dark:text-green-400">
          Reservation requested!
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ll confirm your booking shortly.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tz" value={timezone} />
      <Field>
        <FieldLabel htmlFor="name">Your name</FieldLabel>
        <Input id="name" name="name" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="phone">Phone</FieldLabel>
        <Input id="phone" name="phone" type="tel" />
      </Field>
      <Field>
        <FieldLabel htmlFor="party">Party size</FieldLabel>
        <Input id="party" name="party" type="number" min={1} defaultValue={2} required />
      </Field>
      <Field>
        <FieldLabel htmlFor="when">Date &amp; time</FieldLabel>
        <input id="when" name="when" type="datetime-local" className={inputClass} required />
      </Field>
      <Field>
        <FieldLabel htmlFor="notes">Notes (optional)</FieldLabel>
        <Input id="notes" name="notes" placeholder="Allergies, occasion…" />
      </Field>
      {state && "error" in state ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Booking…" : "Request booking"}
      </Button>
    </form>
  )
}
