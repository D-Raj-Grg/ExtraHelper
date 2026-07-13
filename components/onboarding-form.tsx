"use client"

import { useActionState, useState } from "react"
import { cn } from "@/lib/utils"
import { provisionTenant, type OnboardingState } from "@/app/onboarding/actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PlusIcon, Trash2Icon, UtensilsCrossedIcon } from "lucide-react"

type TaxRule = { name: string; rate: number; inclusive: boolean }

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
  const [rules, setRules] = useState<TaxRule[]>([])
  const setRule = (i: number, patch: Partial<TaxRule>) =>
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addRule = () => setRules((rs) => [...rs, { name: "", rate: 0, inclusive: false }])
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, idx) => idx !== i))

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
            <Select name="currency" defaultValue="USD">
              <SelectTrigger id="currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>Used for all pricing and receipts.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
            <Select name="timezone" defaultValue="UTC">
              <SelectTrigger id="timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {/* Optional — Tax & charges (region-configurable, rule #2) ----- */}
          <input type="hidden" name="taxRules" value={JSON.stringify(rules)} />
          <Field>
            <FieldLabel htmlFor="serviceCharge">Service charge (%)</FieldLabel>
            <Input
              id="serviceCharge"
              name="serviceCharge"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={0}
            />
            <FieldDescription>Optional — added to dine-in bills. Leave 0 if unused.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Tax rules</FieldLabel>
            <FieldDescription>Optional — add your region&apos;s taxes now or later in settings.</FieldDescription>
            <div className="flex flex-col gap-2">
              {rules.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label="Tax name"
                    placeholder="e.g. VAT / GST"
                    value={r.name}
                    onChange={(e) => setRule(i, { name: e.target.value })}
                    className="min-w-32 flex-1"
                  />
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label="Rate percent"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={r.rate}
                      onChange={(e) => setRule(i, { rate: Number(e.target.value) })}
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  <label className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={r.inclusive}
                      onCheckedChange={(v) => setRule(i, { inclusive: v === true })}
                    />
                    Inclusive
                  </label>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => removeRule(i)}
                    aria-label="Remove tax rule"
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              ))}
              <div>
                <Button type="button" size="sm" variant="outline" onClick={addRule}>
                  <PlusIcon className="size-4" /> Add tax rule
                </Button>
              </div>
            </div>
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
