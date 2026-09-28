"use client"

import { useActionState, useState } from "react"
import { toast } from "sonner"

import { saveCoupon, type CouponState } from "@/app/(app)/coupons/actions"
import { businessDay } from "@/lib/format"
import { orderTypeLabel, type OrderType } from "@/lib/order-constants"
import { COUPON_ORDER_TYPES, type CouponRow, type CouponType } from "@/lib/coupon-constants"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ChoiceChip } from "@/components/pos/choice-chip"

/**
 * The campaign editor. Defaults make the flyer case a twenty-second job: 10%
 * off, code generated, no dates, no cap. Everything else is there for the
 * campaign that needs it.
 *
 * Mount it keyed by the coupon's id (or "new") so a different row starts a
 * fresh form rather than inheriting the last one's state.
 */
export function CouponForm({
  open,
  onOpenChange,
  coupon,
  currency,
  timezone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The row being edited, or null for a new campaign. */
  coupon: CouponRow | null
  currency: string
  timezone: string
}) {
  const [type, setType] = useState<CouponType>(coupon?.type ?? "percent")
  const [active, setActive] = useState(coupon?.is_active ?? true)
  const [once, setOnce] = useState(coupon?.once_per_customer ?? false)
  const [orderTypes, setOrderTypes] = useState<OrderType[]>(coupon?.order_types ?? [])
  const redeemed = (coupon?.redemptions ?? 0) > 0

  const [state, action, pending] = useActionState<CouponState, FormData>(
    async (prev, formData) => {
      const result = await saveCoupon(prev, formData)
      if (result && "ok" in result) {
        toast.success(coupon ? "Coupon saved" : "Coupon created")
        onOpenChange(false)
      }
      return result
    },
    undefined,
  )

  // The date inputs speak the tenant's calendar. valid_to is stored as the
  // exclusive start of the next day, so the day shown is one instant earlier.
  const fromDay = coupon?.valid_from ? businessDay(new Date(coupon.valid_from), timezone) : ""
  const toDay = coupon?.valid_to
    ? businessDay(new Date(new Date(coupon.valid_to).getTime() - 1), timezone)
    : ""

  function toggleType(t: OrderType) {
    setOrderTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="md" className="w-full gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{coupon ? `Edit ${coupon.code}` : "New coupon"}</SheetTitle>
          <SheetDescription>
            {coupon
              ? "Changes apply to the next redemption. Bills that already carry it keep their discount."
              : "Leave the code blank and one is made for you. Print its QR from the list."}
          </SheetDescription>
        </SheetHeader>

        <form action={action} className="flex flex-1 flex-col gap-5 px-6 pb-6">
          {coupon ? <input type="hidden" name="id" value={coupon.id} /> : null}
          <fieldset disabled={pending} className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="coupon-code">Code</FieldLabel>
                <Input
                  id="coupon-code"
                  name="code"
                  defaultValue={coupon?.code ?? ""}
                  placeholder="Blank = generate"
                  className="h-11 font-mono uppercase"
                  maxLength={24}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  readOnly={redeemed}
                />
                {redeemed ? (
                  <FieldDescription>Already redeemed, so the printed code stays.</FieldDescription>
                ) : (
                  <FieldDescription>Letters, digits and dashes.</FieldDescription>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="coupon-name">Campaign</FieldLabel>
                <Input
                  id="coupon-name"
                  name="name"
                  defaultValue={coupon?.name ?? ""}
                  placeholder="Dashain flyer"
                  className="h-11"
                  maxLength={80}
                />
                <FieldDescription>For staff; guests see the code.</FieldDescription>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="coupon-type">Discount</FieldLabel>
                <Select value={type} onValueChange={(v) => setType((v ?? "percent") as CouponType)}>
                  <SelectTrigger id="coupon-type" className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent off</SelectItem>
                    <SelectItem value="flat">{currency} off</SelectItem>
                  </SelectContent>
                </Select>
                <input type="hidden" name="type" value={type} />
              </Field>
              <Field>
                <FieldLabel htmlFor="coupon-value">{type === "percent" ? "%" : currency}</FieldLabel>
                <Input
                  id="coupon-value"
                  name="value"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={type === "percent" ? 100 : undefined}
                  step="0.01"
                  defaultValue={coupon?.value ?? 10}
                  className="h-11 text-right tabular-nums"
                  required
                />
              </Field>
            </div>

            <Field orientation="horizontal">
              <Checkbox
                id="coupon-active"
                checked={active}
                onCheckedChange={(v) => setActive(v === true)}
              />
              <FieldLabel htmlFor="coupon-active">Active</FieldLabel>
              {active ? <input type="hidden" name="active" value="on" /> : null}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="coupon-from">Valid from</FieldLabel>
                <Input id="coupon-from" name="valid_from" type="date" defaultValue={fromDay} className="h-11" />
                <FieldDescription>Blank = right away.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="coupon-to">Valid through</FieldLabel>
                <Input id="coupon-to" name="valid_to" type="date" defaultValue={toDay} className="h-11" />
                <FieldDescription>The whole of that day counts.</FieldDescription>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="coupon-limit">Usage limit</FieldLabel>
                <Input
                  id="coupon-limit"
                  name="usage_limit"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  defaultValue={coupon?.usage_limit ?? ""}
                  placeholder="No limit"
                  className="h-11 text-right tabular-nums"
                />
                <FieldDescription>
                  {coupon ? `Used ${coupon.used_count} so far.` : "Total redemptions, across everyone."}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="coupon-min">Minimum order ({currency})</FieldLabel>
                <Input
                  id="coupon-min"
                  name="min_subtotal"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  defaultValue={coupon ? (coupon.min_subtotal_cents / 100).toFixed(2) : ""}
                  placeholder="None"
                  className="h-11 text-right tabular-nums"
                />
                <FieldDescription>Item total before tax and service.</FieldDescription>
              </Field>
            </div>

            <Field orientation="horizontal">
              <Checkbox
                id="coupon-once"
                checked={once}
                onCheckedChange={(v) => setOnce(v === true)}
              />
              <FieldLabel htmlFor="coupon-once">Once per customer</FieldLabel>
              {once ? <input type="hidden" name="once_per_customer" value="on" /> : null}
            </Field>
            <FieldDescription className="-mt-3">
              Needs the customer on the order — a phone number online, or attached at the POS. A
              QR guest with no name attached can&apos;t be told apart.
            </FieldDescription>

            <FieldSet>
              <FieldLegend variant="label">Order types</FieldLegend>
              <FieldDescription className="-mt-2">
                None picked means any order. A QR table counts as dine in.
              </FieldDescription>
              <div className="flex flex-wrap gap-2">
                {COUPON_ORDER_TYPES.map((t) => (
                  <ChoiceChip
                    key={t}
                    type="checkbox"
                    name="order_types_pick"
                    checked={orderTypes.includes(t)}
                    onSelect={() => toggleType(t)}
                    label={orderTypeLabel(t)}
                    showCheck
                  />
                ))}
              </div>
              {orderTypes.map((t) => (
                <input key={t} type="hidden" name="order_types" value={t} />
              ))}
            </FieldSet>
          </fieldset>

          {state && "error" in state ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" className="h-11" disabled={pending}>
              {pending ? "Saving…" : coupon ? "Save coupon" : "Create coupon"}
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
