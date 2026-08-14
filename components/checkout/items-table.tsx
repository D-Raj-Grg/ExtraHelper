"use client"

import { useState } from "react"
import { PercentIcon, Trash2Icon, XIcon } from "lucide-react"

import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { CheckoutItem } from "@/components/checkout/types"

/** Which unit the inline discount column is typed in. */
export type DiscountUnit = "flat" | "percent"

/**
 * The billed lines, editable in place.
 *
 * Discount is a cell, not a button that opens a row: on a counter screen the
 * cashier tabs down the column giving 10% here and 50 off there, and every
 * expand/collapse in between was a wasted tap. The unit toggle lives in the
 * header because it applies to the whole column, exactly like the reference.
 *
 * Rows key on `bill_items.id` — never on the description, which changes under
 * the caret (see CLAUDE.md).
 */
export function CheckoutItemsTable({
  items,
  currency,
  unit,
  onUnitChange,
  canDiscount,
  settled,
  disabled,
  onDiscount,
  onRemoveDiscount,
  onVoid,
}: {
  items: CheckoutItem[]
  currency: string
  unit: DiscountUnit
  onUnitChange: (u: DiscountUnit) => void
  canDiscount: boolean
  settled: boolean
  disabled: boolean
  onDiscount: (orderItemId: string, unit: DiscountUnit, value: number) => void
  onRemoveDiscount: (orderItemId: string) => void
  onVoid: (orderItemId: string, reason: string) => void
}) {
  const editable = canDiscount && !settled
  const [voiding, setVoiding] = useState<CheckoutItem | null>(null)
  const [voidReason, setVoidReason] = useState("")
  // Draft discount text per row id, so typing doesn't fight the server value.
  const [draft, setDraft] = useState<Record<string, string>>({})

  function commit(it: CheckoutItem) {
    const raw = draft[it.id]
    if (raw === undefined) return
    const v = Number(raw)
    setDraft((d) => {
      const next = { ...d }
      delete next[it.id]
      return next
    })
    if (!Number.isFinite(v) || v <= 0 || !it.order_item_id) return
    onDiscount(it.order_item_id, unit, v)
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">S.N</TableHead>
            <TableHead>Item</TableHead>
            <TableHead className="w-16 text-right">Qty</TableHead>
            <TableHead className="w-28 text-right">Rate</TableHead>
            <TableHead className="w-40">
              <span className="flex items-center gap-2">
                Discount
                {editable ? (
                  <span
                    className="inline-flex overflow-hidden rounded-md border"
                    role="group"
                    aria-label="Discount unit"
                  >
                    <UnitButton
                      active={unit === "flat"}
                      label={currency}
                      onClick={() => onUnitChange("flat")}
                    />
                    <UnitButton
                      active={unit === "percent"}
                      label="%"
                      icon
                      onClick={() => onUnitChange("percent")}
                    />
                  </span>
                ) : null}
              </span>
            </TableHead>
            <TableHead className="w-32 text-right">Item total</TableHead>
            {editable ? <TableHead className="w-16 text-right">Void</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={editable ? 7 : 6} className="py-8 text-center text-muted-foreground">
                Nothing on this bill yet — fire the order first, then generate the bill.
              </TableCell>
            </TableRow>
          ) : null}
          {items.map((it, i) => (
            <TableRow key={it.id}>
              <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
              <TableCell>
                <span className="font-medium">{it.description}</span>
                {it.modifiers.length > 0 ? (
                  <ul className="mt-0.5 space-y-0.5">
                    {it.modifiers.map((m) => (
                      <li key={m.id} className="pl-4 text-xs text-muted-foreground">
                        <span aria-hidden>↳ </span>
                        {m.qty > 1 ? `${m.qty}× ` : ""}
                        {m.name}
                        {m.price_cents > 0 ? ` · ${money(m.price_cents, currency)}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{it.qty}</TableCell>
              <TableCell className="text-right tabular-nums">
                {money(it.unit_price_cents, currency)}
              </TableCell>
              <TableCell>
                {editable && it.order_item_id ? (
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    aria-label={`Discount on ${it.description}`}
                    className="h-9 tabular-nums"
                    placeholder={unit === "percent" ? "0 %" : "0.00"}
                    disabled={disabled}
                    value={draft[it.id] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [it.id]: e.target.value }))}
                    onBlur={() => commit(it)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        commit(it)
                      }
                    }}
                  />
                ) : null}
                {it.discount_cents > 0 ? (
                  <div className="mt-1 flex items-center gap-1">
                    <p className="text-xs font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                      − {money(it.discount_cents, currency)} off
                    </p>
                    {editable && it.order_item_id ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        onClick={() => onRemoveDiscount(it.order_item_id!)}
                      >
                        <XIcon className="size-3.5" />
                        <span className="sr-only">Remove the discount on {it.description}</span>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {money(it.total_cents, currency)}
              </TableCell>
              {editable ? (
                <TableCell className="text-right">
                  {it.order_item_id ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 text-destructive"
                      disabled={disabled}
                      onClick={() => {
                        setVoidReason("")
                        setVoiding(it)
                      }}
                    >
                      <Trash2Icon className="size-4" />
                      <span className="sr-only">Void {it.description}</span>
                    </Button>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog open={voiding !== null} onOpenChange={(o) => !o && setVoiding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void {voiding?.description}?</AlertDialogTitle>
            <AlertDialogDescription>
              The line comes off this bill and the kitchen is told to drop it. Stock already
              deducted is returned. The void is recorded against your account with this reason.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Reason (required)"
            aria-label="Void reason"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!voidReason.trim()}
              onClick={() => {
                if (!voiding?.order_item_id || !voidReason.trim()) return
                onVoid(voiding.order_item_id, voidReason)
                setVoiding(null)
              }}
            >
              Void line
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Segment of the header's currency/percent toggle. Module scope — CLAUDE.md. */
function UnitButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean
  label: string
  icon?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "px-2 py-1 text-xs font-semibold transition-colors motion-reduce:transition-none",
        active ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
      )}
    >
      {icon ? (
        <>
          <PercentIcon className="size-3" aria-hidden />
          <span className="sr-only">Discount in percent</span>
        </>
      ) : (
        label
      )}
    </button>
  )
}
