"use client"

import { useActionState, useState } from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { updateSettings, type SettingsState } from "@/app/(app)/settings/actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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

const textareaClass =
  "border-input dark:bg-input/30 min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"

type TaxRule = { name: string; rate: number; inclusive: boolean }

export function SettingsForm({
  currency,
  timezone,
  serviceCharge,
  packagingFee,
  taxRules,
  receipt,
  blockNegativeStock,
}: {
  currency: string
  timezone: string
  serviceCharge: number
  packagingFee: number
  taxRules: TaxRule[]
  receipt: { header: string; footer: string; terms: string }
  blockNegativeStock: boolean
}) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    updateSettings,
    undefined,
  )
  const [rules, setRules] = useState<TaxRule[]>(taxRules)

  const setRule = (i: number, patch: Partial<TaxRule>) =>
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addRule = () => setRules((rs) => [...rs, { name: "", rate: 0, inclusive: false }])
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, idx) => idx !== i))

  return (
    <form action={formAction}>
      {/* Serialize the tax rules for the server action. */}
      <input type="hidden" name="taxRules" value={JSON.stringify(rules)} />

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="currency">Currency</FieldLabel>
          <Select name="currency" defaultValue={currency}>
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
        </Field>
        <Field>
          <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
          <Select name="timezone" defaultValue={timezone}>
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

        {/* Tax rules ------------------------------------------------------- */}
        <Field>
          <FieldLabel>Tax rules</FieldLabel>
          <FieldDescription>
            Region-configurable. Exclusive rules add on top of the subtotal + service; inclusive
            rules are already in the price.
          </FieldDescription>
          <div className="flex flex-col gap-2">
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tax rules — prices are tax-free.</p>
            ) : (
              rules.map((r, i) => (
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
              ))
            )}
            <div>
              <Button type="button" size="sm" variant="outline" onClick={addRule}>
                <PlusIcon className="size-4" /> Add tax rule
              </Button>
            </div>
          </div>
        </Field>

        {/* Receipt template ---------------------------------------------- */}
        <Field>
          <FieldLabel htmlFor="receiptHeader">Receipt header</FieldLabel>
          <Input
            id="receiptHeader"
            name="receiptHeader"
            defaultValue={receipt.header}
            placeholder="Restaurant name / tagline"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="receiptFooter">Receipt footer</FieldLabel>
          <textarea
            id="receiptFooter"
            name="receiptFooter"
            defaultValue={receipt.footer}
            placeholder="Thank you! Visit again."
            className={textareaClass}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="receiptTerms">Receipt terms / notes</FieldLabel>
          <textarea
            id="receiptTerms"
            name="receiptTerms"
            defaultValue={receipt.terms}
            placeholder="No refunds on food. Prices incl. taxes where applicable."
            className={textareaClass}
          />
        </Field>

        <Field>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox name="blockNegativeStock" value="on" defaultChecked={blockNegativeStock} />
            Block sales below zero stock
          </label>
          <FieldDescription>
            When on, firing an item whose ingredients would go negative is rejected. Off by default —
            negatives are allowed and flagged as “oversold”.
          </FieldDescription>
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
