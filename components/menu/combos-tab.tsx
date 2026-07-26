"use client"

import { useState, useTransition } from "react"
import { createCombo, deleteCombo } from "@/app/(app)/menu/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { InlineError, type Combo, type Item } from "./types"

export function CombosTab({ combos, items, currency }: { combos: Combo[]; items: Item[]; currency: string }) {
  const itemNames = new Map(items.map((i) => [i.id, i.name]))

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Combos</h2>
        <p className="text-sm text-muted-foreground">
          Bundle several items at one price, e.g. a Lunch Combo of a burger, fries and a drink.
        </p>
      </div>

      {combos.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 py-2 text-left">Name</TableHead>
                <TableHead className="px-4 py-2 text-left">Price</TableHead>
                <TableHead className="px-4 py-2 text-left">Items</TableHead>
                <TableHead className="px-4 py-2 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {combos.map((c) => (
                <ComboRow key={c.id} combo={c} itemNames={itemNames} currency={currency} />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No combos yet — build one below.
        </p>
      )}

      <ComboBuilder items={items} />
    </div>
  )
}

function ComboBuilder({ items }: { items: Item[] }) {
  const [name, setName] = useState("")
  const [price, setPrice] = useState("")
  const [rows, setRows] = useState<{ item_id: string; qty: number }[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function addRow() {
    const first = items[0]
    if (!first) return
    setRows((r) => [...r, { item_id: first.id, qty: 1 }])
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <h3 className="text-sm font-medium">New combo</h3>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="combo-name">Combo name</Label>
          <Input id="combo-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lunch Combo" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="combo-price">Price</Label>
          <Input id="combo-price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="15.00" className="w-32" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No member items yet.</p>
        ) : (
          rows.map((row, idx) => (
            <div key={idx} className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`combo-item-${idx}`} className="sr-only">
                Combo item {idx + 1}
              </Label>
              <Select
                value={row.item_id}
                onValueChange={(v) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, item_id: v ?? "" } : r)))}
              >
                <SelectTrigger id={`combo-item-${idx}`} className="w-56">
                  <SelectValue placeholder="Pick item" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((it) => (
                    <SelectItem key={it.id} value={it.id}>
                      {it.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label htmlFor={`combo-qty-${idx}`} className="sr-only">
                Quantity for item {idx + 1}
              </Label>
              <Input
                id={`combo-qty-${idx}`}
                type="number"
                min={1}
                step="1"
                className="w-20"
                value={row.qty}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r, i) => (i === idx ? { ...r, qty: Math.max(1, Number(e.target.value) || 1) } : r)),
                  )
                }
              />
              <Button
                size="sm"
                variant="link"
                className="text-destructive"
                aria-label={`Remove member item ${idx + 1}`}
                onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
              >
                Remove
              </Button>
            </div>
          ))
        )}
        <div>
          <Button size="sm" variant="outline" onClick={addRow} disabled={items.length === 0}>
            + Add member item
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setErr(null)
              const res = await createCombo(name, price, rows)
              if (res && "error" in res) setErr(res.error)
              else {
                setName("")
                setPrice("")
                setRows([])
              }
            })
          }
        >
          {pending ? "Saving…" : "Create combo"}
        </Button>
        <InlineError msg={err} />
      </div>
    </div>
  )
}

function ComboRow({ combo, itemNames, currency }: { combo: Combo; itemNames: Map<string, string>; currency: string }) {
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const members = combo.items
    .map((m) => `${itemNames.get(m.item_id) ?? "?"}${m.qty > 1 ? ` ×${m.qty}` : ""}`)
    .join(", ")
  return (
    <TableRow className="border-b last:border-0">
      <TableCell className="px-4 py-2 font-medium">{combo.name}</TableCell>
      <TableCell className="px-4 py-2 text-muted-foreground">{money(combo.price_cents, currency)}</TableCell>
      <TableCell className="px-4 py-2 text-muted-foreground">{members || "—"}</TableCell>
      <TableCell className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            aria-label={`Delete ${combo.name}`}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteCombo(combo.id)
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
