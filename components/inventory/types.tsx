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
}
export type MenuOpt = { id: string; name: string }
export type Recipe = {
  id: string
  qty: number
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

/** Amber "low stock" pill — matches the destructive Badge shape (no warning token exists). */
export const LOW_BADGE = "border-transparent bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"

/** Trim trailing zeros for tidy quantity display. */
export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "")
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
