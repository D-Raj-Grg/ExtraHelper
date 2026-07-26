"use client"

import { useState, useTransition } from "react"

import { logWaste } from "@/app/(app)/inventory/actions"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Item } from "./types"

/** Fast "something got binned" log. Removes stock and records why. */
export function WasteSheet({
  items,
  open,
  onOpenChange,
}: {
  items: Item[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [itemId, setItemId] = useState("")
  const [qty, setQty] = useState("")
  const [kind, setKind] = useState<"wastage" | "staff_meal">("wastage")
  const [reason, setReason] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const item = items.find((i) => i.id === itemId)

  function submit() {
    startTransition(async () => {
      setErr(null)
      const res = await logWaste(itemId, Number(qty), kind, reason)
      if (res && "error" in res) setErr(res.error)
      else {
        setItemId("")
        setQty("")
        setReason("")
        onOpenChange(false)
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="md" className="w-full gap-0">
        <SheetHeader>
          <SheetTitle>Log waste</SheetTitle>
          <SheetDescription>Record spoilage or a staff meal. This removes it from stock.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6">
          <Field>
            <FieldLabel htmlFor="waste-item">Ingredient</FieldLabel>
            <Select value={itemId} onValueChange={(v) => setItemId(v as string)}>
              <SelectTrigger id="waste-item" className="w-full">
                <SelectValue placeholder="Pick an ingredient" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="flex flex-wrap gap-4">
            <Field className="w-32">
              <FieldLabel htmlFor="waste-qty">Quantity</FieldLabel>
              <Input
                id="waste-qty"
                type="number"
                step="0.001"
                min="0"
                inputMode="decimal"
                className="text-right tabular-nums"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
              {item ? <FieldDescription>{item.uom}</FieldDescription> : null}
            </Field>
            <Field className="w-40">
              <FieldLabel htmlFor="waste-kind">Reason type</FieldLabel>
              <Select value={kind} onValueChange={(v) => setKind((v ?? "wastage") as "wastage" | "staff_meal")}>
                <SelectTrigger id="waste-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wastage">Wastage / spoilage</SelectItem>
                  <SelectItem value="staff_meal">Staff meal</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="waste-reason">Note</FieldLabel>
            <Input
              id="waste-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Dropped, expired, comped…"
            />
          </Field>

          <div className="flex items-center gap-3 pt-1">
            <Button type="button" disabled={pending || !itemId || !qty} onClick={submit}>
              {pending ? "Logging…" : "Log waste"}
            </Button>
            {err ? (
              <p className="text-sm text-destructive" role="alert">
                {err}
              </p>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
