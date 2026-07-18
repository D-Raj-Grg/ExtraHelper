"use client"

import { MinusIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { PosCustomer, PosStaff } from "@/components/pos/types"

/** Who the order is for and who's running it. */
export type CheckIn = {
  customerId: string | null
  customerName: string
  customerPhone: string
  guests: number | null
  waiterId: string | null
}

export const EMPTY_CHECK_IN: CheckIn = {
  customerId: null,
  customerName: "",
  customerPhone: "",
  guests: null,
  waiterId: null,
}

const NO_CUSTOMER = "__none__"
const NO_STAFF = "__none__"

function customerLabel(c: PosCustomer): string {
  if (c.name && c.phone) return `${c.name} · ${c.phone}`
  return c.name || c.phone || "Unnamed customer"
}

/**
 * Check-in panel.
 *
 * Controlled and storage-agnostic: create mode holds this in local state until
 * Confirm, amend mode writes it through setOrderDetails. Neither is this
 * component's business — it takes a value and reports changes.
 */
export function CheckInDetails({
  value,
  onChange,
  customers,
  staff,
  disabled = false,
  showGuests = true,
}: {
  value: CheckIn
  onChange: (next: CheckIn) => void
  customers: PosCustomer[]
  staff: PosStaff[]
  disabled?: boolean
  /** Takeaway has no covers to count. */
  showGuests?: boolean
}) {
  const set = (patch: Partial<CheckIn>) => onChange({ ...value, ...patch })

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Check-in details</h3>

      {customers.length > 0 ? (
        <Field>
          <FieldLabel htmlFor="pos-customer">Existing customer</FieldLabel>
          <Select
            value={value.customerId ?? NO_CUSTOMER}
            onValueChange={(v) =>
              set({
                customerId: v === NO_CUSTOMER ? null : (v as string),
                // An id and a typed-in name are two ways to say the same thing;
                // picking one clears the other so the server isn't handed both.
                customerName: "",
                customerPhone: "",
              })
            }
            disabled={disabled}
          >
            <SelectTrigger id="pos-customer" className="w-full">
              <SelectValue placeholder="Walk-in" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CUSTOMER}>Walk-in</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {customerLabel(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {value.customerId === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="pos-cust-name">Customer name</FieldLabel>
            <Input
              id="pos-cust-name"
              value={value.customerName}
              disabled={disabled}
              onChange={(e) => set({ customerName: e.target.value })}
              placeholder="Optional"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pos-cust-phone">Phone</FieldLabel>
            <Input
              id="pos-cust-phone"
              type="tel"
              inputMode="tel"
              value={value.customerPhone}
              disabled={disabled}
              onChange={(e) => set({ customerPhone: e.target.value })}
              placeholder="Optional"
            />
          </Field>
        </div>
      ) : null}

      {showGuests ? <GuestStepper value={value.guests} onChange={(g) => set({ guests: g })} disabled={disabled} /> : null}

      {staff.length > 0 ? (
        <Field>
          <FieldLabel htmlFor="pos-staff">Assign staff</FieldLabel>
          <Select
            value={value.waiterId ?? NO_STAFF}
            onValueChange={(v) => set({ waiterId: v === NO_STAFF ? null : (v as string) })}
            disabled={disabled}
          >
            <SelectTrigger id="pos-staff" className="w-full">
              <SelectValue placeholder="Me" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_STAFF}>Me</SelectItem>
              {staff.map((s) => (
                <SelectItem key={s.user_id} value={s.user_id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
    </div>
  )
}

function GuestStepper({
  value,
  onChange,
  disabled,
}: {
  value: number | null
  onChange: (guests: number | null) => void
  disabled?: boolean
}) {
  const n = value ?? 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-semibold">Guests</span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label="One fewer guest"
          disabled={disabled || n <= 0}
          onClick={() => onChange(n - 1 <= 0 ? null : n - 1)}
        >
          <MinusIcon />
        </Button>
        <span
          aria-live="polite"
          className="min-w-10 text-center text-base font-semibold tabular-nums"
        >
          {n === 0 ? "—" : n}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label="One more guest"
          disabled={disabled || n >= 200}
          onClick={() => onChange(n + 1)}
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  )
}
