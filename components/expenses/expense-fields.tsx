"use client"

import { ChoiceChip } from "@/components/pos/choice-chip"
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  PAID_FROM,
  PAID_FROM_HINTS,
  PAID_FROM_LABELS,
  type ExpenseCategory,
  type PaidFrom,
} from "@/lib/expense-constants"

/**
 * Amount, category, note, paid-from. Shared by the quick-add card and the edit
 * dialog so the two can't drift. Category and paid-from are chips — a waiter
 * logging Rs 100 of rice taps twice, no dropdowns.
 *
 * `idPrefix` keeps label/input ids unique when the edit dialog renders next to
 * the quick-add form.
 */
export function ExpenseFields({
  idPrefix,
  currency,
  categories,
  category,
  onCategory,
  paidFrom,
  onPaidFrom,
  defaultAmount,
  defaultNote,
  autoFocus = false,
}: {
  idPrefix: string
  currency: string
  categories: ExpenseCategory[]
  category: string
  onCategory: (id: string) => void
  paidFrom: PaidFrom
  onPaidFrom: (v: PaidFrom) => void
  defaultAmount?: string
  defaultNote?: string
  autoFocus?: boolean
}) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-amount`}>Amount ({currency})</FieldLabel>
        <Input
          id={`${idPrefix}-amount`}
          name="amount"
          type="number"
          inputMode="decimal"
          min={0.01}
          step="0.01"
          required
          autoFocus={autoFocus}
          defaultValue={defaultAmount}
          placeholder="100"
          className="h-12 text-lg font-semibold tabular-nums"
        />
      </Field>

      <FieldSet>
        <FieldLegend variant="label">Category</FieldLegend>
        <input type="hidden" name="category" value={category} />
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <ChoiceChip
              key={c.id}
              name={`${idPrefix}-category`}
              checked={category === c.id}
              onSelect={() => onCategory(c.id)}
              label={c.name}
              showCheck
            />
          ))}
        </div>
      </FieldSet>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-note`}>What was it for?</FieldLabel>
        <Input
          id={`${idPrefix}-note`}
          name="note"
          required
          maxLength={280}
          defaultValue={defaultNote}
          placeholder="Rice 5kg · Pathao for dishwasher"
          className="h-11"
        />
      </Field>

      <FieldSet>
        <FieldLegend variant="label">Paid from</FieldLegend>
        <input type="hidden" name="paidFrom" value={paidFrom} />
        <div className="grid gap-2 sm:grid-cols-3">
          {PAID_FROM.map((v) => (
            <ChoiceChip
              key={v}
              name={`${idPrefix}-paidFrom`}
              checked={paidFrom === v}
              onSelect={() => onPaidFrom(v)}
              label={PAID_FROM_LABELS[v]}
              detail={PAID_FROM_HINTS[v]}
              showCheck
            />
          ))}
        </div>
      </FieldSet>
    </>
  )
}
