"use client"

import { useActionState, useState, useTransition } from "react"
import { createModifier, deleteModifier } from "@/app/(app)/menu/actions"
import type { MenuState } from "@/app/(app)/menu/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FormError, InlineError, type Modifier } from "./types"

export function ModifiersTab({ modifiers, currency }: { modifiers: Modifier[]; currency: string }) {
  const [state, action, pending] = useActionState<MenuState, FormData>(createModifier, undefined)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Add-ons (modifiers)</h2>
        <p className="text-sm text-muted-foreground">
          Reusable extras such as “Extra cheese” or “No onions”. Create them here once, then attach them to any item
          from the item editor’s <span className="font-medium text-foreground">Add-ons</span> section.
        </p>
      </div>

      {modifiers.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 py-2 text-left">Name</TableHead>
                <TableHead className="px-4 py-2 text-left">Price</TableHead>
                <TableHead className="px-4 py-2 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {modifiers.map((m) => (
                <ModifierRow key={m.id} modifier={m} currency={currency} />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No add-ons yet — add reusable options like “Extra cheese”.
        </p>
      )}

      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="modifier-name">Name</Label>
          <Input id="modifier-name" name="name" placeholder="Extra cheese" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="modifier-price">Price</Label>
          <Input id="modifier-price" name="price" type="number" min={0} step="0.01" placeholder="1.50" className="w-28" />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Adding…" : "Add add-on"}
        </Button>
        <FormError state={state} />
      </form>
    </div>
  )
}

function ModifierRow({ modifier, currency }: { modifier: Modifier; currency: string }) {
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  return (
    <TableRow className="border-b last:border-0">
      <TableCell className="px-4 py-2 font-medium">{modifier.name}</TableCell>
      <TableCell className="px-4 py-2 text-muted-foreground">{money(modifier.price_cents, currency)}</TableCell>
      <TableCell className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            aria-label={`Delete ${modifier.name}`}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteModifier(modifier.id)
                if (res && "error" in res) setErr(res.error)
              })
            }
          >
            Delete
          </Button>
          <InlineError msg={err} />
        </div>
      </TableCell>
    </TableRow>
  )
}
