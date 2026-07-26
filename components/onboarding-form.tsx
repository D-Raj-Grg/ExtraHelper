"use client"

import Link from "next/link"
import { useActionState, useState, useTransition } from "react"
import { cn } from "@/lib/utils"
import {
  provisionTenant,
  redeemCode,
  claimInvites,
  type OnboardingState,
  type JoinState,
} from "@/app/onboarding/actions"
import { switchTenant } from "@/app/(app)/tenant-actions"
import { initialsFor } from "@/lib/initials"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
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
import {
  ChevronLeftIcon,
  PlusIcon,
  RefreshCwIcon,
  StoreIcon,
  Trash2Icon,
  UserPlusIcon,
} from "lucide-react"

type TaxRule = { name: string; rate: number; inclusive: boolean }
type Step = "start" | "create" | "join"
type Intent = "create" | "join"

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

export function OnboardingForm({
  className,
  defaultName = "",
  isAdd,
  hasTenant,
  profile,
  memberships,
  pending: pendingMemberships,
  ...props
}: React.ComponentProps<"div"> & {
  defaultName?: string
  isAdd: boolean
  hasTenant: boolean
  profile: {
    fullName: string | null
    username: string | null
    avatarUrl: string | null
    email: string | null
  }
  memberships: { tenantId: string; role: string; name: string; slug: string }[]
  pending: { tenantId: string; name: string; role: string }[]
}) {
  const [step, setStep] = useState<Step>("start")

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {step === "start" ? (
        <StartStep
          profile={profile}
          isAdd={isAdd}
          hasTenant={hasTenant}
          onContinue={(intent) => setStep(intent)}
        />
      ) : step === "create" ? (
        <CreateStep
          defaultName={defaultName}
          isAdd={isAdd}
          onBack={() => setStep("start")}
        />
      ) : (
        <JoinStep
          isAdd={isAdd}
          memberships={memberships}
          pending={pendingMemberships}
          onBack={() => setStep("start")}
        />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- step 1 --- */

function StartStep({
  profile,
  isAdd,
  hasTenant,
  onContinue,
}: {
  profile: {
    fullName: string | null
    username: string | null
    avatarUrl: string | null
    email: string | null
  }
  isAdd: boolean
  hasTenant: boolean
  onContinue: (intent: Intent) => void
}) {
  const [intent, setIntent] = useState<Intent>("create")
  const displayName =
    profile.fullName ?? profile.email?.split("@")[0] ?? "there"

  return (
    <FieldGroup>
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-bold">Get Started</h1>
        <FieldDescription>Let&apos;s set up your workspace.</FieldDescription>
      </div>

      {/* Profile card */}
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <Avatar size="lg">
          {profile.avatarUrl ? (
            <AvatarImage src={profile.avatarUrl} alt={displayName} />
          ) : null}
          <AvatarFallback>
            {initialsFor(profile.fullName, profile.email)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate font-medium">{displayName}</div>
          <div className="truncate text-sm text-muted-foreground">
            {profile.username ? `@${profile.username}` : null}
            {profile.username && profile.email ? " · " : null}
            {profile.email}
          </div>
        </div>
      </div>

      {/* "I want to" radio group */}
      <Field>
        <FieldLabel>I want to</FieldLabel>
        <div
          role="radiogroup"
          aria-label="What would you like to do?"
          className="flex flex-col gap-2"
        >
          <IntentRow
            selected={intent === "create"}
            onSelect={() => setIntent("create")}
            icon={<StoreIcon className="size-5" />}
            title="Create New Restaurant"
            description="Start fresh and set up your own workspace."
          />
          <IntentRow
            selected={intent === "join"}
            onSelect={() => setIntent("join")}
            icon={<UserPlusIcon className="size-5" />}
            title="Join Existing Restaurant"
            description="Use an invite or join code from an owner."
          />
        </div>
      </Field>

      <Field>
        <Button type="button" onClick={() => onContinue(intent)}>
          Continue
        </Button>
      </Field>

      {isAdd || hasTenant ? (
        <div className="text-center">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to dashboard
          </Link>
        </div>
      ) : null}
    </FieldGroup>
  )
}

function IntentRow({
  selected,
  onSelect,
  icon,
  title,
  description,
}: {
  selected: boolean
  onSelect: () => void
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left outline-none transition-colors",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "hover:bg-muted/50",
      )}
    >
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-md",
          selected
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
    </button>
  )
}

/* ---------------------------------------------------------------- step 2 --- */

function CreateStep({
  defaultName,
  isAdd,
  onBack,
}: {
  defaultName: string
  isAdd: boolean
  onBack: () => void
}) {
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
    <form action={formAction}>
      <FieldGroup>
        <BackLink onClick={onBack} />
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-xl font-bold">Create your restaurant</h1>
          <FieldDescription>
            A few details to get your workspace ready.
          </FieldDescription>
        </div>

        {/* Force a brand-new tenant on the "add restaurant" flow. */}
        <input type="hidden" name="add" value={isAdd ? "1" : ""} />

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
  )
}

/* ---------------------------------------------------------------- step 3 --- */

function JoinStep({
  isAdd,
  memberships,
  pending,
  onBack,
}: {
  isAdd: boolean
  memberships: { tenantId: string; role: string; name: string; slug: string }[]
  pending: { tenantId: string; name: string; role: string }[]
  onBack: () => void
}) {
  const [state, formAction, redeeming] = useActionState<JoinState, FormData>(
    redeemCode,
    undefined,
  )
  const [enterPending, startEnter] = useTransition()
  const [refreshing, startRefresh] = useTransition()

  return (
    <FieldGroup>
      <BackLink onClick={onBack} />
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-bold">Join a restaurant</h1>
        <FieldDescription>
          Use a join code, or accept an invite from an owner.
        </FieldDescription>
      </div>

      {/* Awaiting approval */}
      {pending.length > 0 ? (
        <Field>
          <FieldLabel>Awaiting approval</FieldLabel>
          <div className="flex flex-col gap-2">
            {pending.map((p) => (
              <div
                key={p.tenantId}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-sm text-muted-foreground">
                    An owner must approve you.
                  </div>
                </div>
                <Badge variant="secondary">pending</Badge>
              </div>
            ))}
          </div>
        </Field>
      ) : null}

      {/* Existing restaurants (only when adding) */}
      {isAdd && memberships.length > 0 ? (
        <Field>
          <FieldLabel>Your restaurants</FieldLabel>
          <div className="flex flex-col gap-2">
            {memberships.map((m) => (
              <div
                key={m.tenantId}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{m.name}</div>
                  <div className="text-sm text-muted-foreground capitalize">
                    {m.role}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={enterPending}
                  onClick={() => startEnter(() => switchTenant(m.tenantId))}
                >
                  Enter
                </Button>
              </div>
            ))}
          </div>
        </Field>
      ) : null}

      {/* Join by code */}
      <form action={formAction}>
        <Field>
          <FieldLabel htmlFor="code">Join code</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="code"
              name="code"
              type="text"
              placeholder="ABC123"
              autoCapitalize="characters"
              className="uppercase"
              required
            />
            <Button type="submit" disabled={redeeming}>
              {redeeming ? "Joining…" : "Join"}
            </Button>
          </div>
          <FieldDescription>
            Ask an owner or manager for your restaurant&apos;s join code.
          </FieldDescription>
        </Field>
        {state ? (
          "error" in state ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : state.already ? (
            <p className="text-sm text-muted-foreground" role="status">
              You&apos;re already a member of {state.name} ({state.status}).
            </p>
          ) : state.status === "pending" ? (
            <p className="text-sm text-muted-foreground" role="status">
              Requested to join {state.name} — an owner will approve you.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground" role="status">
              Joined {state.name}.
            </p>
          )
        ) : null}
      </form>

      <div className="flex justify-center">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={refreshing}
          onClick={() =>
            startRefresh(async () => {
              await claimInvites()
            })
          }
        >
          <RefreshCwIcon className={cn("size-4", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing…" : "Refresh invites"}
        </Button>
      </div>
    </FieldGroup>
  )
}

/* ------------------------------------------------------------------ misc --- */

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" /> back
      </button>
    </div>
  )
}
