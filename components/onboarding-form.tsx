"use client"

import { useActionState } from "react"
import { cn } from "@/lib/utils"
import { provisionTenant, type OnboardingState } from "@/app/onboarding/actions"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { UtensilsCrossedIcon } from "lucide-react"

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "NPR", "AED", "SGD", "AUD", "CAD", "JPY"]

// Region is configurable, never hardcoded (rule #2) — a small starter list;
// full tz picker comes with the settings screen.
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

export function OnboardingForm({
  className,
  defaultName = "",
  ...props
}: React.ComponentProps<"div"> & { defaultName?: string }) {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(
    provisionTenant,
    undefined,
  )

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form action={formAction}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex size-8 items-center justify-center rounded-md">
              <UtensilsCrossedIcon className="size-6" />
            </div>
            <h1 className="text-xl font-bold">Set up your restaurant</h1>
            <FieldDescription>
              A few details to get your workspace ready.
            </FieldDescription>
          </div>
          <Field>
            <FieldLabel htmlFor="restaurantName">Restaurant name</FieldLabel>
            <Input
              id="restaurantName"
              name="restaurantName"
              type="text"
              placeholder="Acme Diner"
              defaultValue={defaultName}
              autoComplete="organization"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="currency">Currency</FieldLabel>
            <select id="currency" name="currency" defaultValue="USD" className={selectClass}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <FieldDescription>Used for all pricing and receipts.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
            <select id="timezone" name="timezone" defaultValue="UTC" className={selectClass}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Field>
          {state?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <Field>
            <Button type="submit" disabled={pending}>
              {pending ? "Setting up…" : "Create workspace"}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </div>
  )
}
