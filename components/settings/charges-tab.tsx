"use client"

import { PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { CARD_GRID, type TaxRule } from "./types"

export function ChargesTab({
  serviceCharge,
  packagingFee,
  rules,
  setRules,
}: {
  serviceCharge: number
  packagingFee: number
  rules: TaxRule[]
  setRules: React.Dispatch<React.SetStateAction<TaxRule[]>>
}) {
  const setRule = (i: number, patch: Partial<TaxRule>) =>
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addRule = () => setRules((rs) => [...rs, { name: "", rate: 0, inclusive: false }])
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, idx) => idx !== i))

  return (
    <div className={CARD_GRID}>
      <Card>
        <CardHeader>
          <CardTitle>Charges</CardTitle>
          <CardDescription>Fees added on top of the items on a bill.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
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
                className="tabular-nums"
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
                className="tabular-nums"
              />
              <FieldDescription>Flat amount on takeaway and delivery orders.</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax rules</CardTitle>
          <CardDescription>
            Exclusive rules add on top of the subtotal + service; inclusive rules are already in the
            price.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {rules.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No tax rules yet — prices are tax-free.
                </p>
              </div>
            ) : (
              rules.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={`Tax name, rule ${i + 1}`}
                    placeholder="e.g. VAT / GST"
                    value={r.name}
                    onChange={(e) => setRule(i, { name: e.target.value })}
                    className="min-w-32 flex-1"
                  />
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label={`Rate percent, rule ${i + 1}`}
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={r.rate}
                      onChange={(e) => setRule(i, { rate: Number(e.target.value) })}
                      className="w-24 tabular-nums"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  <FieldLabel className="flex items-center gap-1.5 font-normal">
                    <Checkbox
                      checked={r.inclusive}
                      onCheckedChange={(v) => setRule(i, { inclusive: v === true })}
                      aria-label={`Inclusive, rule ${i + 1}`}
                    />
                    Inclusive
                  </FieldLabel>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => removeRule(i)}
                    aria-label={`Remove tax rule ${i + 1}`}
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
        </CardContent>
      </Card>
    </div>
  )
}
