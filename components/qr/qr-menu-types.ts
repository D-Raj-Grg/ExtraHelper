/**
 * Shapes and cart maths for the guest-facing menus (QR dine-in `/t/[token]`,
 * storefront `/s/[slug]`). A plain module — no server imports — so the client
 * components below can share it without dragging `next/headers` into the
 * browser bundle.
 */

export type QrVariant = { id: string; name: string; price_delta_cents: number }

export type QrItem = {
  id: string
  name: string
  description: string | null
  price_cents: number
  is_veg: boolean | null
  image_url?: string | null
  variants?: QrVariant[]
}

export type QrCategory = { id: string; name: string; items: QrItem[] }

/** One thing in the guest's order: a dish, at one size, some number of times. */
export type QrCartLine = {
  /** `itemId|variantId` — stable across re-renders, unlike anything derived from qty. */
  key: string
  itemId: string
  variantId: string | null
  /** What the guest sees on the review list: "Buff Sekuwa · Half Kg". */
  label: string
  unitPriceCents: number
  qty: number
}

export function lineKey(itemId: string, variantId: string | null): string {
  return `${itemId}|${variantId ?? ""}`
}

/**
 * What this dish can actually cost.
 *
 * Never `price_cents` alone: a dish with sizes forces a choice, so its base
 * price is a figure nobody can order — and several of them are stored as 0,
 * which rendered as a flat "NPR 0.00" on the guest menu.
 */
export function qrItemPriceRange(item: QrItem): { min: number; max: number } {
  const variants = item.variants ?? []
  if (variants.length === 0) return { min: item.price_cents, max: item.price_cents }
  const prices = variants.map((v) => item.price_cents + v.price_delta_cents)
  return { min: Math.min(...prices), max: Math.max(...prices) }
}

export function variantPrice(item: QrItem, variantId: string | null): number {
  const v = (item.variants ?? []).find((x) => x.id === variantId)
  return item.price_cents + (v?.price_delta_cents ?? 0)
}

export function cartTotal(lines: QrCartLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0)
}

export function cartCount(lines: QrCartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0)
}

/** Free-text match over a dish: its own words, plus the category it sits in. */
export function itemMatches(item: QrItem, categoryName: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = [item.name, item.description ?? "", categoryName, ...(item.variants ?? []).map((v) => v.name)]
    .join(" ")
    .toLowerCase()
  return q.split(/\s+/).every((word) => hay.includes(word))
}
