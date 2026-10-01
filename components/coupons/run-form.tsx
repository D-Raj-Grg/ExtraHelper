"use client"

import { useState, useTransition } from "react"
import { PlusIcon, SaveIcon } from "lucide-react"
import { toast } from "sonner"

import { createCouponBatch, updateCouponBatch } from "@/app/(app)/coupons/actions"
import {
  addDays,
  couponDayInput,
  couponValueLabel,
  todayInZone,
  type CouponBatchRow,
  type CouponType,
} from "@/lib/coupon-constants"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/** How long a new run is valid unless the owner says otherwise. */
const DEFAULT_DAYS = 30

type Problems = Partial<Record<"name" | "count" | "prefix" | "value" | "from" | "to", string>>

/**
 * The run's details. Creating asks for everything; editing offers only what can
 * still change (the name and the dates), because the codes, prefix and discount
 * are already printed on paper.
 *
 * A new run starts today and ends in 30 days. "Never expires" leaves the end
 * open, which the database already treats as no end.
 */
export function RunForm({
  run,
  slug,
  currency,
  timezone,
  onDone,
}: {
  /** Present when editing an existing run. */
  run: CouponBatchRow | null
  slug: string
  currency: string
  timezone: string
  /** Called with the run's id once it is saved. */
  onDone: (id: string) => void
}) {
  // Today in the restaurant's zone, fixed when the form opens.
  const [today] = useState(() => todayInZone(timezone))

  const [name, setName] = useState(run?.name ?? "")
  const [count, setCount] = useState("100")
  const [prefix, setPrefix] = useState(slug.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase() || "FLYR")
  const [type, setType] = useState<CouponType>("percent")
  const [value, setValue] = useState("10")
  const [from, setFrom] = useState(run ? couponDayInput(run.valid_from, timezone) : today)
  const [to, setTo] = useState(run ? couponDayInput(run.valid_to, timezone, true) : addDays(today, DEFAULT_DAYS))
  const [forever, setForever] = useState(run ? run.valid_to === null : false)
  const [dineIn, setDineIn] = useState(true)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // What is wrong right now, per field. The button stays off until nothing is.
  const problems: Problems = {}
  if (!name.trim()) problems.name = "Give the run a name."
  if (!run) {
    const n = Number(count)
    if (!Number.isInteger(n) || n < 1 || n > 1000) problems.count = "Enter a whole number from 1 to 1000."
    if (!/^[A-Z0-9]{2,8}$/.test(prefix)) problems.prefix = "2 to 8 letters or digits."
    const v = Number(value)
    if (!Number.isFinite(v) || v <= 0) problems.value = "Enter an amount above zero."
    else if (type === "percent" && v > 100) problems.value = "A discount can't be more than 100%."
  }
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) problems.from = "Pick a real date."
  if (!forever) {
    if (!to) problems.to = "Pick an end date, or tick Never expires."
    else if (from && to < from) problems.to = "That is before the start date."
    // Only a changed end date has to be in the future: renaming an expired run must stay possible.
    else if (to < today && (!run || to !== couponDayInput(run.valid_to, timezone, true))) {
      problems.to = "That date has already passed."
    }
  }
  const invalid = Object.keys(problems).length > 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (invalid) return
    const validTo = forever ? "" : to
    start(async () => {
      const res = run
        ? await updateCouponBatch({ batchId: run.id, name, validFrom: from, validTo })
        : await createCouponBatch({
            name,
            count: Number(count),
            prefix,
            type,
            value: Number(value),
            validFrom: from,
            validTo,
            dineInOnly: dineIn,
          })
      if ("error" in res) {
        setError(res.error)
        return
      }
      toast.success(run ? "Run updated." : `${count} codes created.`)
      onDone(res.id)
    })
  }

  const err = (k: keyof Problems) => (problems[k] ? <p role="alert" className="text-sm text-destructive">{problems[k]}</p> : null)

  return (
    <form id="run-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="run-name">Name</FieldLabel>
          <Input id="run-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dashain flyers" className="h-11" aria-invalid={!!problems.name && name !== ""} required />
          {name !== "" ? err("name") : null}
        </Field>

        {run ? (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground sm:col-span-2">
            {run.issued} codes · {couponValueLabel(run.type, run.value, currency)}. The codes, prefix and discount are
            already printed, so they can&apos;t change. You can still rename the run and move its dates.
          </p>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="run-count">How many flyers</FieldLabel>
              <Input id="run-count" type="number" inputMode="numeric" min={1} max={1000} value={count} onChange={(e) => setCount(e.target.value)} className="h-11" aria-invalid={!!problems.count} required />
              {err("count") ?? <FieldDescription>1 to 1000. Order a few extra.</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor="run-prefix">Code prefix</FieldLabel>
              <Input id="run-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} maxLength={8} className="h-11 font-mono" aria-invalid={!!problems.prefix} required />
              {err("prefix") ?? <FieldDescription>Codes look like {prefix || "SEKU"}-K7M2QX.</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor="run-type">Discount</FieldLabel>
              <Select value={type} onValueChange={(v) => setType((v ?? "percent") as CouponType)}>
                <SelectTrigger id="run-type" className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent off</SelectItem>
                  <SelectItem value="flat">{currency} off</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="run-value">{type === "percent" ? "Percent" : currency}</FieldLabel>
              <Input id="run-value" type="number" inputMode="decimal" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} className="h-11" aria-invalid={!!problems.value} required />
              {err("value")}
            </Field>
          </>
        )}

        <Field>
          <FieldLabel htmlFor="run-from">Valid from</FieldLabel>
          <Input id="run-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11" aria-invalid={!!problems.from} />
          {err("from") ?? <FieldDescription>{from === today ? "Today." : from ? "" : "Empty means valid straight away."}</FieldDescription>}
        </Field>
        <Field>
          <FieldLabel htmlFor="run-to">Valid through</FieldLabel>
          <Input
            id="run-to"
            type="date"
            value={forever ? "" : to}
            min={from && from > today ? from : today}
            onChange={(e) => setTo(e.target.value)}
            disabled={forever}
            className="h-11"
            aria-invalid={!!problems.to}
          />
          {err("to") ?? (
            <FieldDescription>
              {forever ? "No end date: the codes never expire." : "Match the date printed on the flyer."}
            </FieldDescription>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="run-forever"
              checked={forever}
              onCheckedChange={(v) => {
                const on = v === true
                setForever(on)
                // Turning it off brings back a sensible end rather than an empty box.
                if (!on && !to) setTo(addDays(from && from > today ? from : today, DEFAULT_DAYS))
              }}
            />
            <FieldLabel htmlFor="run-forever" className="font-normal">
              Never expires
            </FieldLabel>
          </div>
        </Field>
      </div>

      {run ? null : (
        <Field orientation="horizontal">
          <Checkbox id="run-dinein" checked={dineIn} onCheckedChange={(v) => setDineIn(v === true)} />
          <FieldLabel htmlFor="run-dinein">Dine-in only</FieldLabel>
        </Field>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" className="h-11" disabled={pending || invalid}>
          {run ? <SaveIcon className="size-4" /> : <PlusIcon className="size-4" />}
          {pending ? "Saving…" : run ? "Save details" : "Create run and continue"}
        </Button>
      </div>
    </form>
  )
}
