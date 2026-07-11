"use client"

import { useActionState } from "react"
import { updateSettings, type SettingsState } from "@/app/settings/actions"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "NPR", "AED", "SGD", "AUD", "CAD", "JPY"]
const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
]

const selectClass =
  "border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"

export function SettingsForm({
  currency,
  timezone,
  serviceCharge,
  packagingFee,
}: {
  currency: string
  timezone: string
  serviceCharge: number
  packagingFee: number
}) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    updateSettings,
    undefined,
  )

  return (
    <form action={formAction}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="currency">Currency</FieldLabel>
          <select id="currency" name="currency" defaultValue={currency} className={selectClass}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
          <select id="timezone" name="timezone" defaultValue={timezone} className={selectClass}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="serviceCharge">Service charge (%)</FieldLabel>
          <Input
            id="serviceCharge"
            name="serviceCharge"
            type="number"
            min={0}
            max={100}
            step="0.01"
            defaultValue={serviceCharge}
          />
          <FieldDescription>Added to every dine-in bill.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="packagingFee">Packaging fee</FieldLabel>
          <Input
            id="packagingFee"
            name="packagingFee"
            type="number"
            min={0}
            step="0.01"
            defaultValue={packagingFee}
          />
        </Field>
        {state && "error" in state ? (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}
        {state && "ok" in state ? (
          <p className="text-sm text-green-600 dark:text-green-400" role="status">
            Settings saved.
          </p>
        ) : null}
        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
