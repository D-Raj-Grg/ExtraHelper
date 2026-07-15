import localforage from "localforage"

// Caches the menu + tables so the POS order composer works offline (warm tab).
// `image_url` is optional: entries cached before photos shipped simply fall back
// to the monogram placeholder rather than breaking the tile.
export type CachedMenuItem = {
  id: string
  name: string
  base_price_cents: number
  is_86: boolean
  image_url?: string | null
}
export type CachedTable = { id: string; label: string; state: string }
export type MenuCache = { items: CachedMenuItem[]; tables: CachedTable[]; savedAt: number }

const store = localforage.createInstance({ name: "extrahelper", storeName: "menu_cache" })

export async function saveMenuCache(items: CachedMenuItem[], tables: CachedTable[]): Promise<void> {
  await store.setItem<MenuCache>("menu", { items, tables, savedAt: Date.now() })
}

export async function loadMenuCache(): Promise<MenuCache | null> {
  return store.getItem<MenuCache>("menu")
}
