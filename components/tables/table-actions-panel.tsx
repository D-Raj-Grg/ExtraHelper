"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { money } from "@/lib/format"
import { NEW_TAKEAWAY, type ActiveOrder, type Table } from "./types"

/**
 * Transfer / merge / split for one table's order.
 *
 * Defined at module scope on purpose: nested inside its parent, React would see
 * a brand-new component type on every parent render and remount the subtree,
 * wiping the split checkboxes and dropdown picks. This panel lives under a
 * Realtime subscription, so any colleague touching any table re-renders the
 * parent — mid-split selections must survive that.
 */
export function TableActionsPanel({
  table,
  order,
  others,
  mergeTargets,
  currency,
  pending,
  onTransfer,
  onMerge,
  onSplit,
  className,
}: {
  table: Table
  order: ActiveOrder | undefined
  others: Table[]
  mergeTargets: Table[]
  currency: string
  pending: boolean
  onTransfer: (fromId: string, toId: string) => void
  onMerge: (primaryId: string, otherId: string) => void
  onSplit: (fromId: string, toId: string | null, itemIds: string[]) => void
  className?: string
}) {
  const items = (order?.order_items ?? []).filter((i) => !i.is_void)

  const [transferTo, setTransferTo] = useState("")
  const [mergeWith, setMergeWith] = useState("")
  const [splitTo, setSplitTo] = useState<string>(NEW_TAKEAWAY)
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  const selectedItemIds = items.filter((i) => checked[i.id]).map((i) => i.id)

  return (
    <div className={className}>
      <div className="mt-3 flex flex-col gap-4 rounded-md border bg-muted/30 p-3 text-xs">
        <div className="flex flex-col gap-1.5">
          <span className="font-medium">Transfer order to</span>
          {others.length === 0 ? (
            <p className="text-muted-foreground">No other table to move this order to.</p>
          ) : (
            <div className="flex gap-2">
              <Select value={transferTo} onValueChange={(v) => setTransferTo(String(v ?? ""))}>
                <SelectTrigger className="w-full" aria-label={`Transfer ${table.label} to table`}>
                  <SelectValue placeholder="Pick a table" />
                </SelectTrigger>
                <SelectContent>
                  {others.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || !transferTo}
                onClick={() => transferTo && onTransfer(table.id, transferTo)}
              >
                Transfer
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-medium">Merge with</span>
          {mergeTargets.length === 0 ? (
            <p className="text-muted-foreground">No other table has an active order.</p>
          ) : (
            <div className="flex gap-2">
              <Select value={mergeWith} onValueChange={(v) => setMergeWith(String(v ?? ""))}>
                <SelectTrigger className="w-full" aria-label={`Merge ${table.label} with table`}>
                  <SelectValue placeholder="Pick a table" />
                </SelectTrigger>
                <SelectContent>
                  {mergeTargets.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || !mergeWith}
                onClick={() => mergeWith && onMerge(table.id, mergeWith)}
              >
                Merge
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-medium">Split items</span>
          {items.length === 0 ? (
            <p className="text-muted-foreground">No items on this order to split.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1">
                {items.map((i) => (
                  <li key={i.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`split-${table.id}-${i.id}`}
                      checked={!!checked[i.id]}
                      onCheckedChange={(c) =>
                        setChecked((prev) => ({ ...prev, [i.id]: c === true }))
                      }
                    />
                    <label
                      htmlFor={`split-${table.id}-${i.id}`}
                      className="flex flex-1 cursor-pointer justify-between gap-2 py-1"
                    >
                      <span>
                        {i.qty}× {i.name_snapshot}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {money(i.unit_price_cents * i.qty, currency)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Select
                  value={splitTo}
                  onValueChange={(v) => setSplitTo(String(v ?? NEW_TAKEAWAY))}
                >
                  <SelectTrigger className="w-full" aria-label="Split selected items to">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_TAKEAWAY}>New takeaway order</SelectItem>
                    {others.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending || selectedItemIds.length === 0}
                  onClick={() =>
                    onSplit(table.id, splitTo === NEW_TAKEAWAY ? null : splitTo, selectedItemIds)
                  }
                >
                  Split{selectedItemIds.length > 0 ? ` (${selectedItemIds.length})` : ""}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
