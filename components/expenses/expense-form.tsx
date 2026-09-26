"use client"

import { useActionState, useRef, useState } from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { recordExpense, type ExpenseState } from "@/app/(app)/expenses/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { RECEIPT_ACCEPT, type ExpenseCategory, type PaidFrom } from "@/lib/expense-constants"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ExpenseFields } from "./expense-fields"

/**
 * Impure, so it lives at module scope: called from a state initialiser and from
 * the action, never during render. The key makes a double-tap on a slow
 * connection land once — record_expense returns the existing row for a repeat.
 */
function newClientKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

function defaultCategory(categories: ExpenseCategory[]): string {
  return categories[0]?.id ?? ""
}

/** The quick-add card: amount, tap a category, a few words, done. */
export function ExpenseForm({
  date,
  today,
  currency,
  categories,
  canBackdate,
}: {
  date: string
  today: string
  currency: string
  categories: ExpenseCategory[]
  canBackdate: boolean
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [category, setCategory] = useState(() => defaultCategory(categories))
  const [paidFrom, setPaidFrom] = useState<PaidFrom>("cash")
  const [clientKey, setClientKey] = useState(newClientKey)

  // Reset from inside the action, not an effect — the result is already here.
  const [state, action, pending] = useActionState<ExpenseState, FormData>(
    async (prev, formData) => {
      const result = await recordExpense(prev, formData)
      if (result && "ok" in result) {
        formRef.current?.reset()
        setClientKey(newClientKey())
        toast.success("Expense logged")
      }
      return result
    },
    undefined,
  )

  const pastDay = date < today
  const locked = pastDay && !canBackdate
  const noCategories = categories.length === 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log an expense</CardTitle>
        <CardDescription>
          {pastDay
            ? locked
              ? "This is an earlier day. Only a manager can add to it."
              : "Adding to an earlier day — it counts toward that day's close."
            : "Anything spent for the restaurant today — rice, gas, a ride home for staff."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {noCategories ? (
          <p className="text-sm text-muted-foreground">
            No categories yet. Ask a manager to add one under Categories.
          </p>
        ) : (
          <form ref={formRef} action={action} className="flex flex-col gap-5">
            <fieldset disabled={locked || pending} className="flex flex-col gap-5">
              <input type="hidden" name="clientKey" value={clientKey} />
              {pastDay ? <input type="hidden" name="date" value={date} /> : null}
              <ExpenseFields
                idPrefix="new-expense"
                currency={currency}
                categories={categories}
                category={category}
                onCategory={setCategory}
                paidFrom={paidFrom}
                onPaidFrom={setPaidFrom}
              />
              <Field>
                <FieldLabel htmlFor="new-expense-receipt">Receipt photo (optional)</FieldLabel>
                <Input
                  id="new-expense-receipt"
                  name="receipt"
                  type="file"
                  accept={RECEIPT_ACCEPT}
                  capture="environment"
                  className="h-11"
                />
                <FieldDescription>Snap the bill if there is one. Up to 5 MB.</FieldDescription>
              </Field>
            </fieldset>

            {state && "error" in state ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}

            <Button type="submit" size="lg" className="h-12" disabled={locked || pending}>
              <PlusIcon className="size-4" />
              {pending ? "Saving…" : "Add expense"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
