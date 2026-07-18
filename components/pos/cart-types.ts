import type { PlaceLine } from "@/app/(app)/pos/actions"
import type { PosMenuItem } from "@/components/pos/types"

/**
 * A line in the composer's cart.
 *
 * `lineId` is the identity and nothing else is. In create mode it's a minted
 * id; in amend mode it's the order_items row id. Either way it's stable for the
 * life of the line, which is the whole point — see lineSignature below.
 */
export type CartLine = {
  lineId: string
  /** null ⇒ an off-menu custom line. */
  itemId: string | null
  /** Display only. The server re-derives name_snapshot from the item + variant. */
  name: string
  variantId: string | null
  variantName: string | null
  /** Sorted at construction, always — lineSignature depends on it. */
  modifierIds: string[]
  modifierNames: string[]
  notes: string | null
  course: number | null
  seat: number | null
  qty: number
  /**
   * DISPLAY ONLY in create mode: it exists so the rail can show a running total
   * before Confirm. place_staff_order recomputes every menu price from
   * menu_items/item_variants/modifiers and ignores whatever we send.
   *
   * In amend mode this is the server's own snapshot, so it *is* authoritative.
   *
   * The exception either way is a custom line, which has no server-side price
   * to recompute from — that number is clamped and role-gated instead.
   */
  unitPriceCents: number
  /** Amend only: a held line is staged, not fired. */
  isHeld?: boolean
  /** Amend only: gates delete-vs-void. */
  status?: string
}

/** What the dish grid / options dialog hands to cart.add(). */
export type NewLineDraft = Omit<CartLine, "lineId">

/**
 * What to call this line on screen.
 *
 * Create mode keeps `name` and `variantName` apart, so rendering `name` alone
 * gives two bare "Buff Sekuwa" rows that differ only by unit price — a waiter
 * can't tell KG from Half KG at a glance. Amend mode gets the server's
 * name_snapshot, which already folds the variant in and leaves variantName
 * null, so this is a no-op there. Same string from both modes, which is why it
 * belongs here and not in a branch.
 */
export function cartLineTitle(l: Pick<CartLine, "name" | "variantName">): string {
  return l.variantName ? `${l.name} (${l.variantName})` : l.name
}

/**
 * Merge-eligibility only. **Never a React key and never an identity.**
 *
 * The tempting shortcut is to key rows by this. Don't: it changes on every
 * keystroke in the remarks field, so React unmounts the row mid-word and the
 * caret goes with it. Same trap as holding an editor by value instead of by id.
 */
export function lineSignature(l: CartLine | NewLineDraft): string {
  return [
    l.itemId ?? `custom:${l.name}:${l.unitPriceCents}`,
    l.variantId ?? "",
    [...l.modifierIds].sort().join(","),
    l.notes ?? "",
    l.course ?? "",
    l.seat ?? "",
  ].join("|")
}

/** Module scope, and only ever called from an event handler — never in render. */
export function newLineId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

/**
 * The port both modes implement. Everything below the two flow components takes
 * one of these and never asks which mode it's in — an optional method that's
 * absent *is* the answer. Add a `mode` field here and the conditionals grow
 * back everywhere.
 */
export type CartController = {
  lines: CartLine[]
  totalCents: number
  dishCount: number
  /** A write is in flight (amend); always false in create. */
  busy: boolean
  add: (draft: NewLineDraft) => void
  setQty: (lineId: string, qty: number) => void
  patch: (
    lineId: string,
    fields: { notes?: string | null; course?: number | null; seat?: number | null },
  ) => void
  remove: (lineId: string) => void
  /** Present ⇒ lines can be held back from the kitchen. Absent in create. */
  setHold?: (lineId: string, hold: boolean) => void
  /** Present ⇒ a fired line needs a reasoned void rather than a delete. */
  voidLine?: (lineId: string, reason: string) => void
  /** False ⇒ this line is already away; it must go through voidLine. */
  canDelete: (lineId: string) => boolean
}

/** Base + variant delta + modifiers. Mirrors the RPC, for display only. */
export function draftUnitPrice(
  item: PosMenuItem,
  variantId: string | null,
  modifierIds: string[],
): number {
  const variant = item.variants?.find((v) => v.id === variantId)
  const mods = (item.modifiers ?? []).filter((m) => modifierIds.includes(m.id))
  return (
    item.base_price_cents +
    (variant?.price_delta_cents ?? 0) +
    mods.reduce((sum, m) => sum + m.price_cents, 0)
  )
}

/**
 * The prices a waiter can actually ring up for this dish.
 *
 * Not the same as base_price_cents: when a dish has variants the options dialog
 * *forces* one (there's no "no variant" chip), so the base price on its own is
 * unbuyable — a tile showing it quotes a number that can't be ordered.
 *
 * Add-ons are deliberately excluded. They're optional, so they don't move the
 * floor or the ceiling of what the dish costs.
 */
export function itemPriceRange(item: PosMenuItem): { min: number; max: number } {
  const variants = item.variants ?? []
  if (variants.length === 0) {
    return { min: item.base_price_cents, max: item.base_price_cents }
  }
  const prices = variants.map((v) => item.base_price_cents + v.price_delta_cents)
  return { min: Math.min(...prices), max: Math.max(...prices) }
}

export function cartTotalCents(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0)
}

export function cartDishCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0)
}

/** Cart → wire. lineId, name and the display names all get dropped here. */
export function toPlaceLines(lines: CartLine[]): PlaceLine[] {
  return lines.map((l) =>
    l.itemId === null
      ? {
          custom_name: l.name,
          unit_price_cents: l.unitPriceCents,
          qty: l.qty,
          notes: l.notes,
          course: l.course,
          seat: l.seat,
        }
      : {
          item_id: l.itemId,
          qty: l.qty,
          variant_id: l.variantId,
          modifier_ids: l.modifierIds,
          notes: l.notes,
          course: l.course,
          seat: l.seat,
        },
  )
}
