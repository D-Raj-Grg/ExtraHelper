import type { MenuState } from "@/app/(app)/menu/actions"

export type Category = { id: string; name: string; sort: number | null; is_active: boolean }
export type Station = { id: string; name: string }
export type Modifier = { id: string; name: string; price_cents: number }
export type Item = {
  id: string
  name: string
  description: string | null
  base_price_cents: number
  is_86: boolean
  /** null = unmarked (render nothing); true = vegetarian; false = non-vegetarian. */
  is_veg: boolean | null
  image_url: string | null
  category_id: string | null
  item_station_routes: { station_id: string; kitchen_stations: { name: string } | null }[]
  item_variants: { id: string; name: string; price_delta_cents: number }[]
  item_modifiers: {
    modifier_id: string
    is_default: boolean
    max_qty: number
    modifiers: { id: string; name: string; price_cents: number } | null
  }[]
  item_availability: { id: string; day_of_week: number | null; start_time: string; end_time: string }[]
}
export type Combo = {
  id: string
  name: string
  price_cents: number
  items: { item_id: string; qty: number }[]
  is_active: boolean
}

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export function dayLabel(d: number | null) {
  return d === null || d === undefined ? "Every day" : DAY_NAMES[d] ?? `Day ${d}`
}

/** Error paragraph for a `useActionState` form result. */
export function FormError({ state }: { state: MenuState }) {
  if (state && "error" in state)
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.error}
      </p>
    )
  return null
}

/** Small inline error paragraph for non-form (transition) mutations. */
export function InlineError({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <p className="text-sm text-destructive" role="alert">
      {msg}
    </p>
  )
}
