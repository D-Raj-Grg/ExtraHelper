"use client"

import { useCallback, useMemo, useTransition } from "react"
import { toast } from "sonner"

import {
  addCustomItem,
  addItem,
  removeItem,
  setLineHold,
  setLineQty,
  updateLine,
  voidLine as voidLineAction,
  type PosState,
} from "@/app/(app)/pos/actions"
import {
  cartDishCount,
  cartTotalCents,
  type CartController,
  type CartLine,
  type NewLineDraft,
} from "@/components/pos/cart-types"
import type { PosOrderDetail } from "@/components/pos/types"

/** A line that's already away to the kitchen can't just be deleted. */
const DELETABLE_STATUSES = ["draft", "placed"]

function toCartLine(l: PosOrderDetail["order_items"][number]): CartLine {
  const mods = l.order_item_modifiers ?? []
  return {
    lineId: l.id,
    itemId: l.item_id,
    name: l.name_snapshot,
    variantId: l.variant_id,
    variantName: null, // already folded into name_snapshot by the server
    modifierIds: mods.map((m) => m.modifier_id).filter((x): x is string => x !== null),
    modifierNames: mods.map((m) => m.name_snapshot),
    notes: l.notes,
    course: l.course,
    seat: l.seat,
    qty: l.qty,
    unitPriceCents: l.unit_price_cents,
    isHeld: l.is_held,
    status: l.status,
  }
}

/**
 * Amend-mode cart: every edit is a server action, applied immediately.
 *
 * It can't batch like create does. These lines may already be fired, and a
 * void then needs a reason and an audit row — you can't collect that halfway
 * through a diff, and a half-applied batch would leave the kitchen and the bill
 * disagreeing about what was ordered.
 */
export function useAmendCart(detail: PosOrderDetail, refetch: () => void): CartController {
  const [busy, start] = useTransition()
  const orderId = detail.id

  // Derived from the server rows on every render — never copied into state.
  // Holding a snapshot here is what makes a successful save look like it did
  // nothing until you close and reopen the editor.
  const lines = useMemo(
    () => (detail.order_items ?? []).filter((l) => !l.is_void).map(toCartLine),
    [detail.order_items],
  )

  const run = useCallback(
    (fn: () => Promise<PosState>) => {
      start(async () => {
        const res = await fn()
        if (res && "error" in res) {
          toast.error(res.error)
          return
        }
        // Don't wait for the Realtime round trip through Postgres — the
        // terminal that made the change should see it first, not last.
        refetch()
      })
    },
    [refetch],
  )

  const add = useCallback(
    (draft: NewLineDraft) => {
      run(() =>
        draft.itemId === null
          ? addCustomItem(orderId, {
              name: draft.name,
              unitPriceCents: draft.unitPriceCents,
              qty: draft.qty,
              notes: draft.notes,
              course: draft.course,
              seat: draft.seat,
            })
          : addItem(orderId, draft.itemId, {
              variantId: draft.variantId,
              modifierIds: draft.modifierIds,
              notes: draft.notes,
              course: draft.course,
              seat: draft.seat,
              qty: draft.qty,
            }),
      )
    },
    [orderId, run],
  )

  const setQty = useCallback(
    (lineId: string, qty: number) => {
      const line = lines.find((l) => l.lineId === lineId)
      if (qty < 1) {
        // Stepping to zero means "remove" — but only if it's still ours to
        // remove. A fired line has to be voided with a reason instead.
        if (line && DELETABLE_STATUSES.includes(line.status ?? "")) {
          run(() => removeItem(orderId, lineId))
        }
        return
      }
      run(() => setLineQty(orderId, lineId, qty))
    },
    [lines, orderId, run],
  )

  const patch = useCallback(
    (lineId: string, fields: { notes?: string | null; course?: number | null; seat?: number | null }) => {
      run(() => updateLine(orderId, lineId, fields))
    },
    [orderId, run],
  )

  const remove = useCallback(
    (lineId: string) => {
      run(() => removeItem(orderId, lineId))
    },
    [orderId, run],
  )

  const setHold = useCallback(
    (lineId: string, hold: boolean) => {
      run(() => setLineHold(orderId, lineId, hold))
    },
    [orderId, run],
  )

  const voidLine = useCallback(
    (lineId: string, reason: string) => {
      run(() => voidLineAction(orderId, lineId, reason))
    },
    [orderId, run],
  )

  const canDelete = useCallback(
    (lineId: string) => {
      const line = lines.find((l) => l.lineId === lineId)
      return DELETABLE_STATUSES.includes(line?.status ?? "")
    },
    [lines],
  )

  return useMemo(
    () => ({
      lines,
      totalCents: cartTotalCents(lines),
      dishCount: cartDishCount(lines),
      busy,
      add,
      setQty,
      patch,
      remove,
      setHold,
      voidLine,
      canDelete,
    }),
    [lines, busy, add, setQty, patch, remove, setHold, voidLine, canDelete],
  )
}
