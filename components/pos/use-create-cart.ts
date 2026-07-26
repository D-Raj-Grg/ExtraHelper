"use client"

import { useCallback, useMemo, useState } from "react"

import {
  cartDishCount,
  cartTotalCents,
  lineSignature,
  newLineId,
  type CartController,
  type CartLine,
  type NewLineDraft,
} from "@/components/pos/cart-types"

/**
 * Create-mode cart: pure local state. Nothing reaches the server until Confirm,
 * which is what makes composing an order feel instant on a phone with bad wifi.
 *
 * setHold and voidLine are intentionally absent — a line that has never been
 * fired can't be held back from the kitchen or voided, it's just removed.
 * Leaving them undefined is how the shared rail knows that without a mode flag.
 */
export function useCreateCart(): CartController {
  const [lines, setLines] = useState<CartLine[]>([])

  const add = useCallback((draft: NewLineDraft) => {
    setLines((prev) => {
      // Merge happens once, here, and never again. Two taps of the same dish
      // with the same options are one line ×2; the same dish with a different
      // variant is a second line. After that the line has an identity and edits
      // never re-merge it — even if a remarks edit makes two signatures equal.
      // Two identical-looking lines are a lesser evil than one silently
      // swallowing another while the waiter is typing in it.
      const sig = lineSignature(draft)
      const at = prev.findIndex((l) => lineSignature(l) === sig)
      if (at !== -1) {
        const next = [...prev]
        next[at] = { ...next[at], qty: Math.min(99, next[at].qty + draft.qty) }
        return next
      }
      return [...prev, { ...draft, lineId: newLineId() }]
    })
  }, [])

  const setQty = useCallback((lineId: string, qty: number) => {
    setLines((prev) =>
      qty < 1
        ? prev.filter((l) => l.lineId !== lineId)
        : prev.map((l) => (l.lineId === lineId ? { ...l, qty: Math.min(99, qty) } : l)),
    )
  }, [])

  const patch = useCallback(
    (lineId: string, fields: { notes?: string | null; course?: number | null; seat?: number | null }) => {
      setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, ...fields } : l)))
    },
    [],
  )

  const remove = useCallback((lineId: string) => {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId))
  }, [])

  const canDelete = useCallback(() => true, [])

  return useMemo(
    () => ({
      lines,
      totalCents: cartTotalCents(lines),
      dishCount: cartDishCount(lines),
      busy: false,
      add,
      setQty,
      patch,
      remove,
      canDelete,
    }),
    [lines, add, setQty, patch, remove, canDelete],
  )
}
