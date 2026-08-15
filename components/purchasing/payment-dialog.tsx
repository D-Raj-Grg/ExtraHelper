"use client"

import { useActionState, useState } from "react"
import { BanknoteIcon } from "lucide-react"
import { recordSupplierPayment, type PurchState } from "@/app/(app)/purchasing/actions"
import { SUPPLIER_METHOD_LABELS } from "@/lib/purchasing-constants"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type SupplierOption = { id: string; name: string }

/**
 * Money paid to a supplier. Two shapes, one form:
 *
 * - against a PO (`poId` set, supplier fixed) — settling a delivery
 * - a quick purchase (`poId` null, supplier picked) — a receipt that is one
 *   total for several goods, with no honest per-item split to put on PO lines
 *
 * Either way this records money, never stock.
 */
export function PaymentDialog({
  currency,
  suppliers,
  poId = null,
  supplierId = null,
  triggerLabel,
  outstandingCents,
}: {
  currency: string
  suppliers: SupplierOption[]
  poId?: string | null
  supplierId?: string | null
  triggerLabel: string
  /** Prefills the amount when settling a PO. */
  outstandingCents?: number
}) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<PurchState, FormData>(
    async (prev, formData) => {
      const result = await recordSupplierPayment(prev, formData)
      if (result && "ok" in result) setOpen(false)
      return result
    },
    undefined,
  )

  const fixedSupplier = supplierId !== null
  const today = new Date().toISOString().slice(0, 10)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm">
            <BanknoteIcon className="size-4" />
            {triggerLabel}
          </Button>
        }
      />
      <DialogContent size="sm">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{poId ? "Record payment" : "Quick purchase"}</DialogTitle>
            <DialogDescription>
              Paying in cash also records a payout against your open drawer, so the shift still
              reconciles. If the money came from somewhere else, pick bank or other.
            </DialogDescription>
          </DialogHeader>

          {poId ? <input type="hidden" name="poId" value={poId} /> : null}
          {fixedSupplier ? <input type="hidden" name="supplierId" value={supplierId} /> : null}

          <DialogBody className="flex flex-col gap-4">
            {!fixedSupplier ? (
              <Field>
                <FieldLabel htmlFor="pay-supplier">Supplier</FieldLabel>
                <Select name="supplierId" required>
                  <SelectTrigger id="pay-supplier" className="w-full">
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Add the supplier above first if they are not listed.
                </FieldDescription>
              </Field>
            ) : null}

            <Field>
              <FieldLabel htmlFor="pay-amount">Amount ({currency})</FieldLabel>
              <Input
                id="pay-amount"
                name="amount"
                type="number"
                inputMode="decimal"
                min={0.01}
                step="0.01"
                defaultValue={
                  outstandingCents && outstandingCents > 0
                    ? (outstandingCents / 100).toFixed(2)
                    : undefined
                }
                required
                className="tabular-nums"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="pay-method">Paid by</FieldLabel>
              <Select name="method" defaultValue="cash">
                <SelectTrigger id="pay-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SUPPLIER_METHOD_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Cash needs an open drawer. Paid before opening, or from your own pocket? Use other.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="pay-date">Date paid</FieldLabel>
              <Input id="pay-date" name="paidAt" type="date" defaultValue={today} />
            </Field>

            <Field>
              <FieldLabel htmlFor="pay-note">What was it for?</FieldLabel>
              <Input
                id="pay-note"
                name="note"
                maxLength={280}
                placeholder="Tissue, mint flavour, coil, plastic"
              />
              <FieldDescription>
                {poId
                  ? "Optional — the purchase order already lists the goods."
                  : "List the goods. This records the spend and what you owe; it does not change stock counts."}
              </FieldDescription>
            </Field>

            {state && "error" in state ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button type="submit" disabled={pending} className="h-11">
              {pending ? "Recording…" : "Record payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
