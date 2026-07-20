import type { InvState } from "@/app/(app)/inventory/actions"

export type Item = {
  id: string
  name: string
  uom: string
  category: string | null
  current_qty: number
  reorder_level: number
  par_level: number | null
  cost_cents: number
  supplier_id: string | null
}
export type SupplierOpt = { id: string; name: string }
export type ModifierOpt = { id: string; name: string }
export type ModifierIngredient = {
  id: string
  modifier_id: string
  inventory_item_id: string
  qty: number
}
export type MenuOpt = { id: string; name: string; price_cents: number }
export type VariantOpt = { id: string; item_id: string; name: string; recipe_scale: number }
export type Recipe = {
  id: string
  qty: number
  menu_item_id: string
  inventory_item_id: string
  menu_items: { name: string } | null
  inventory_items: { name: string; uom: string } | null
}
export type CostRow = {
  inventory_item_id: string
  qty: number
  unit_cost_cents: number | null
  created_at: string
}
export type CountRow = { id: string; created_at: string; posted_at: string | null }

export type MoveType = "purchase" | "wastage" | "adjustment" | "staff_meal" | "transfer"

export const MOVE_LABELS: Record<MoveType, string> = {
  purchase: "Received",
  wastage: "Wastage",
  staff_meal: "Staff meal",
  transfer: "Transfer",
  adjustment: "Adjustment",
}

/** Every stock-movement type, including the ones the system writes (sale/count). */
export const ALL_MOVE_LABELS: Record<string, string> = {
  ...MOVE_LABELS,
  sale: "Sold (auto)",
  count: "Count reconcile",
}

/** Amber "low stock" pill — matches the destructive Badge shape (no warning token exists). */
export const LOW_BADGE = "border-transparent bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"

/** Trim trailing zeros for tidy quantity display. */
export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "")
}

/**
 * Food-cost bands. Below ~35% is healthy (emerald), 35–45% is a warning (amber),
 * above is bleeding margin (destructive). Colour is paired with a label/icon at
 * the call site — never colour alone.
 */
export type CostBand = "good" | "warn" | "bad"
export function foodCostBand(pct: number): CostBand {
  if (pct <= 35) return "good"
  if (pct <= 45) return "warn"
  return "bad"
}

/** Error paragraph for a `useActionState` form result. */
export function FormError({ state }: { state: InvState }) {
  if (state && "error" in state)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    )
  return null
}
