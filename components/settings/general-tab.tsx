"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { CARD_GRID, CURRENCIES, DAY_CUTOFFS, TIMEZONES } from "./types"

export function GeneralTab({
  restaurantName,
  currency,
  timezone,
  dayCutoffMinutes,
  paymentGateway,
  blockNegativeStock,
  qrAutoFire,
}: {
  restaurantName: string
  currency: string
  timezone: string
  dayCutoffMinutes: number
  paymentGateway: string
  blockNegativeStock: boolean
  qrAutoFire: boolean
}) {
  return (
    <div className={CARD_GRID}>
      <Card>
        <CardHeader>
          <CardTitle>Restaurant</CardTitle>
          <CardDescription>
            Name, currency and timezone. Every amount and time in the app follows these.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="restaurantName">Restaurant name</FieldLabel>
              <Input
                id="restaurantName"
                name="restaurantName"
                defaultValue={restaurantName}
                placeholder="The Sekuwa Station"
              />
              <FieldDescription>Shown in the sidebar, receipts and storefront.</FieldDescription>
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
              <FieldDescription>Report windows and shift times are cut on this clock.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="dayCutoffMinutes">Day starts at</FieldLabel>
              <Select name="dayCutoffMinutes" defaultValue={String(dayCutoffMinutes)}>
                <SelectTrigger id="dayCutoffMinutes" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_CUTOFFS.map((c) => (
                    <SelectItem key={c.value} value={String(c.value)}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                When the trading day turns over. Set it to 4:00 am and a sale at 1:30 am counts
                towards the night before. Reports, the day-close sheet and the POS Completed tab
                all follow it. Changing it re-buckets past days, so yesterday&apos;s figures can
                move.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
            <CardDescription>Which gateway takes customer card payments.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
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
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operations</CardTitle>
            <CardDescription>
              How the floor behaves when stock runs out, and what happens to a guest&apos;s QR
              order the moment they send it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Field>
              <FieldLabel htmlFor="qrAutoFire" className="flex items-center gap-2 font-medium">
                <Checkbox
                  id="qrAutoFire"
                  name="qrAutoFire"
                  value="on"
                  defaultChecked={qrAutoFire}
                />
                Send QR orders straight to the kitchen
              </FieldLabel>
              <FieldDescription>
                On by default — a guest&apos;s order prints its tickets the moment it is placed.
                Turn it off if a waiter should check the table first: the order then waits on the
                POS board with a “Send to kitchen” button, and the cooks see nothing until it is
                tapped.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel
                htmlFor="blockNegativeStock"
                className="flex items-center gap-2 font-medium"
              >
                <Checkbox
                  id="blockNegativeStock"
                  name="blockNegativeStock"
                  value="on"
                  defaultChecked={blockNegativeStock}
                />
                Block sales below zero stock
              </FieldLabel>
              <FieldDescription>
                When on, firing an item whose ingredients would go negative is rejected. Off by
                default — negatives are allowed and flagged as “oversold”.
              </FieldDescription>
            </Field>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
