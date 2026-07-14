"use client"

import { useActionState, useState, useTransition } from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"
import {
  updateSettings,
  uploadTenantLogo,
  createBranch,
  updateBranch,
  deleteBranch,
  type SettingsState,
} from "@/app/(app)/settings/actions"
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
type Branch = { id: string; name: string; address: string | null; is_default: boolean }

export function SettingsForm({
  restaurantName,
  currency,
  timezone,
  serviceCharge,
  packagingFee,
  taxRules,
  receipt,
  blockNegativeStock,
  paymentGateway,
  logoUrl,
  branches,
  canManageBranches,
}: {
  restaurantName: string
  currency: string
  timezone: string
  serviceCharge: number
  packagingFee: number
  taxRules: TaxRule[]
  receipt: { header: string; footer: string; terms: string }
  blockNegativeStock: boolean
  paymentGateway: string
  logoUrl: string | null
  branches: Branch[]
  canManageBranches: boolean
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

  const [logoState, logoAction, logoPending] = useActionState<SettingsState, FormData>(
    uploadTenantLogo,
    undefined,
  )

  return (
    <div className="flex flex-col gap-8">
    <form action={formAction}>
      {/* Serialize the tax rules for the server action. */}
      <input type="hidden" name="taxRules" value={JSON.stringify(rules)} />

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="restaurantName">Restaurant name</FieldLabel>
          <Input
            id="restaurantName"
            name="restaurantName"
            defaultValue={restaurantName}
            placeholder="The Sekuwa Station"
          />
        </Field>
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

        {/* Payment gateway (rule #6) ------------------------------------- */}
        <Field>
          <FieldLabel htmlFor="paymentGateway">Payment gateway</FieldLabel>
          <Select name="paymentGateway" defaultValue={paymentGateway}>
            <SelectTrigger id="paymentGateway" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sandbox">Sandbox (test)</SelectItem>
              <SelectItem value="manual">Manual / cash-terminal</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>
            Real gateways (Stripe / eSewa / Khalti) register under their own key later.
          </FieldDescription>
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

    {/* Branding / logo (separate multipart form) ----------------------- */}
    <form action={logoAction}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="logo">Branding / logo</FieldLabel>
          <FieldDescription>Shown on receipts and storefront.</FieldDescription>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Current logo"
              className="h-16 w-16 rounded-md border object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No logo uploaded yet.</p>
          )}
          <Input id="logo" name="logo" type="file" accept="image/*" />
          {logoState && "error" in logoState ? (
            <p className="text-sm text-destructive" role="alert">
              {logoState.error}
            </p>
          ) : null}
          {logoState && "ok" in logoState ? (
            <p className="text-sm text-green-600 dark:text-green-400" role="status">
              Logo updated.
            </p>
          ) : null}
        </Field>
        <Field>
          <Button type="submit" variant="outline" disabled={logoPending}>
            {logoPending ? "Uploading…" : "Upload logo"}
          </Button>
        </Field>
      </FieldGroup>
    </form>

    {/* Branches (multi-branch) ---------------------------------------- */}
    {canManageBranches ? <BranchesSection branches={branches} /> : null}
    </div>
  )
}

function BranchesSection({ branches }: { branches: Branch[] }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [createState, createAction, creating] = useActionState<SettingsState, FormData>(
    createBranch,
    undefined,
  )

  const runUpdate = (id: string, fields: { name?: string; address?: string | null }) =>
    startTransition(async () => {
      const res = await updateBranch(id, fields)
      setError(res && "error" in res ? res.error : null)
    })
  const runDelete = (id: string) =>
    startTransition(async () => {
      const res = await deleteBranch(id)
      setError(res && "error" in res ? res.error : null)
    })

  return (
    <div>
      <FieldGroup>
        <Field>
          <FieldLabel>Branches</FieldLabel>
          <FieldDescription>Manage locations for this tenant.</FieldDescription>
          <div className="flex flex-col gap-2">
            {branches.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Branch name"
                  defaultValue={b.name}
                  disabled={b.is_default || pending}
                  onBlur={(e) =>
                    !b.is_default && e.target.value !== b.name
                      ? runUpdate(b.id, { name: e.target.value })
                      : undefined
                  }
                  className="min-w-32 flex-1"
                />
                <Input
                  aria-label="Branch address"
                  placeholder="Address"
                  defaultValue={b.address ?? ""}
                  disabled={b.is_default || pending}
                  onBlur={(e) =>
                    !b.is_default && e.target.value !== (b.address ?? "")
                      ? runUpdate(b.id, { address: e.target.value })
                      : undefined
                  }
                  className="min-w-32 flex-1"
                />
                {b.is_default ? (
                  <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
                    Default
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => runDelete(b.id)}
                    aria-label="Delete branch"
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </Field>
      </FieldGroup>

      <form action={createAction} className="mt-2">
        <div className="flex flex-wrap items-end gap-2">
          <Input name="name" placeholder="New branch name" className="min-w-32 flex-1" required />
          <Input name="address" placeholder="Address (optional)" className="min-w-32 flex-1" />
          <Button type="submit" size="sm" variant="outline" disabled={creating}>
            <PlusIcon className="size-4" /> {creating ? "Adding…" : "Add branch"}
          </Button>
        </div>
        {createState && "error" in createState ? (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {createState.error}
          </p>
        ) : null}
      </form>
    </div>
  )
}
