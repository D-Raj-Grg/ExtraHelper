"use client"

import { useState } from "react"
import { UserIcon, UserPlusIcon } from "lucide-react"

import { money } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { CheckoutCustomer } from "@/components/checkout/types"
import { CustomerPicker } from "@/components/customer-picker"

/**
 * Who the bill is for, and what gets printed under the lines.
 *
 * The customer isn't decoration: a credit (unpaid) checkout needs someone to
 * chase, and loyalty can only be redeemed once one is attached.
 */
export function CheckoutCustomerPanel({
  customer,
  currency,
  pointsValueCents,
  note,
  onNoteChange,
  onNoteCommit,
  onAttach,
  onPick,
  servedBy,
  settled,
  disabled,
}: {
  customer: CheckoutCustomer | null
  currency: string
  pointsValueCents: number
  note: string
  onNoteChange: (v: string) => void
  onNoteCommit: () => void
  onAttach: (name: string, phone: string) => void
  /** Attach someone already in the book, by id — keeps their points with them. */
  onPick: (customerId: string) => void
  servedBy: string | null
  settled: boolean
  disabled: boolean
}) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <UserIcon className="size-4" aria-hidden />
          Customer
        </h3>
        {customer ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{customer.name ?? "Customer"}</span>
            {customer.phone ? (
              <span className="text-sm tabular-nums text-muted-foreground">{customer.phone}</span>
            ) : null}
            <Badge className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
              {customer.points} pts · {money(customer.points * Math.max(1, pointsValueCents), currency)}
            </Badge>
          </div>
        ) : settled ? (
          <p className="text-sm text-muted-foreground">Walk-in — no customer attached.</p>
        ) : (
          <div className="space-y-3">
            <CustomerPicker
              id="cust-search"
              currency={currency}
              pointsValueCents={pointsValueCents}
              disabled={disabled}
              onPick={onPick}
            />
            <p className="text-xs font-medium text-muted-foreground">Or someone new</p>
            <div className="flex flex-wrap items-end gap-2">
              <Field className="min-w-32 flex-1">
                <FieldLabel htmlFor="cust-name">Name</FieldLabel>
                <Input
                  id="cust-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Optional"
                />
              </Field>
              <Field className="w-36">
                <FieldLabel htmlFor="cust-phone">Phone</FieldLabel>
                <Input
                  id="cust-phone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Optional"
                  className="tabular-nums"
                />
              </Field>
              <Button
                variant="secondary"
                disabled={disabled || (!name.trim() && !phone.trim())}
                onClick={() => {
                  onAttach(name, phone)
                  setName("")
                  setPhone("")
                }}
              >
                <UserPlusIcon className="size-4" />
                Attach
              </Button>
            </div>
          </div>
        )}
      </div>

      <Field>
        <FieldLabel htmlFor="bill-note">Remarks on invoice</FieldLabel>
        <Textarea
          id="bill-note"
          rows={3}
          value={note}
          disabled={settled || disabled}
          onChange={(e) => onNoteChange(e.target.value)}
          onBlur={onNoteCommit}
          placeholder="Printed under the items — e.g. “Corporate account, PO 4471”."
        />
      </Field>

      {servedBy ? (
        <p className="text-sm text-muted-foreground">
          Served by <span className="font-medium text-foreground">{servedBy}</span>
        </p>
      ) : null}
    </div>
  )
}
