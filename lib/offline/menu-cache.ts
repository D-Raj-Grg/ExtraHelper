import localforage from "localforage"

// Caches the menu + tables so the POS order composer works offline (warm tab).
//
// Every field beyond the original five is optional, and deliberately so: a blob
// written by an older build has to keep deserializing after a deploy. A warm
// tab that loses its menu mid-service is worse than one showing a menu without
// categories. Same reason `image_url` is optional — entries cached before photos
// shipped fall back to the monogram rather than breaking the tile.
export type CachedVariant = { id: string; name: string; price_delta_cents: number }
export type CachedModifier = { id: string; name: string; price_cents: number }

export type CachedMenuItem = {
  id: string
  name: string
  base_price_cents: number
  is_86: boolean
  image_url?: string | null
  category_id?: string | null
  variants?: CachedVariant[]
  modifiers?: CachedModifier[]
  /** null/absent = unmarked; true = vegetarian; false = non-vegetarian. */
  is_veg?: boolean | null
}
export type CachedTable = {
  id: string
  label: string
  state: string
  capacity?: number | null
  floor_id?: string | null
}
export type CachedCategory = { id: string; name: string; sort?: number | null }
export type CachedFloor = { id: string; name: string }

export type MenuCache = {
  items: CachedMenuItem[]
  tables: CachedTable[]
  categories?: CachedCategory[]
  floors?: CachedFloor[]
  savedAt: number
}

const store = localforage.createInstance({ name: "extrahelper", storeName: "menu_cache" })

export async function saveMenuCache(cache: Omit<MenuCache, "savedAt">): Promise<void> {
  await store.setItem<MenuCache>("menu", { ...cache, savedAt: Date.now() })
}

export async function loadMenuCache(): Promise<MenuCache | null> {
  return store.getItem<MenuCache>("menu")
}
