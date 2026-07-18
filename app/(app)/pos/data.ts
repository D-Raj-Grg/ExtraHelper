import { createClient } from "@/lib/supabase/server"
import {
  ACTIVE_ORDER_STATUSES,
  KOT_CARD_SELECT,
  KOT_TAB_STATUSES,
  ORDER_CARD_SELECT,
  ORDER_DETAIL_SELECT,
} from "@/lib/pos-constants"
import type {
  PosCustomer,
  PosData,
  PosKot,
  PosMenuItem,
  PosOrderCard,
  PosOrderDetail,
  PosStaff,
} from "@/components/pos/types"

type MenuRow = {
  id: string
  name: string
  base_price_cents: number
  is_86: boolean
  is_veg: boolean | null
  image_url: string | null
  category_id: string | null
  item_variants: { id: string; name: string; price_delta_cents: number }[]
  item_modifiers: { modifiers: { id: string; name: string; price_cents: number } | null }[]
}

/**
 * Everything /pos and /pos/[orderId] render. Both show the same screen — the
 * only difference is whether the modal starts open — so the fetch lives here
 * rather than being written twice.
 */
export async function loadPosData(tenantId: string): Promise<PosData> {
  const supabase = await createClient()

  const [tables, floors, categories, menu, orders, customers, staff, kots] = await Promise.all([
    supabase
      .from("restaurant_tables")
      .select("id, label, state, capacity, floor_id")
      .eq("tenant_id", tenantId)
      .order("label"),
    supabase.from("floors").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase
      .from("menu_categories")
      .select("id, name, sort")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sort")
      .order("name"),
    supabase
      .from("menu_items")
      .select(
        "id, name, base_price_cents, is_86, is_veg, image_url, category_id, " +
          "item_variants(id, name, price_delta_cents), " +
          "item_modifiers(modifiers(id, name, price_cents))",
      )
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("orders")
      .select(ORDER_CARD_SELECT)
      .eq("tenant_id", tenantId)
      .in("status", ACTIVE_ORDER_STATUSES)
      // Pinned orders float to the top; newest-first within each group.
      .order("pinned_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      // Without this the embedded lines come back in no defined order and
      // reshuffle between fetches.
      .order("created_at", { referencedTable: "order_items" }),
    // Capped: an unbounded customer select would ship the whole CRM to every
    // till. A type-ahead is the follow-up if a tenant outgrows this.
    supabase
      .from("customers")
      .select("id, name, phone")
      .eq("tenant_id", tenantId)
      .order("name")
      .limit(200),
    supabase.rpc("list_order_staff", { _tenant: tenantId }),
    // Kitchen tickets for the KOT tab. Served included so the "Completed KOTs"
    // toggle has something to reveal without a second round trip; the tab hides
    // them by default.
    supabase
      .from("kots")
      .select(KOT_CARD_SELECT)
      .eq("tenant_id", tenantId)
      .in("status", KOT_TAB_STATUSES)
      .order("created_at", { ascending: false }),
  ])

  // Flatten the modifier embed here so the client and the IndexedDB cache see
  // one shape — the cache can't hold a nested join.
  const menuRows = (menu.data ?? []) as unknown as MenuRow[]
  const items: PosMenuItem[] = menuRows.map((m) => ({
    id: m.id,
    name: m.name,
    base_price_cents: m.base_price_cents,
    is_86: m.is_86,
    is_veg: m.is_veg,
    image_url: m.image_url,
    category_id: m.category_id,
    variants: m.item_variants ?? [],
    modifiers: (m.item_modifiers ?? [])
      .map((x) => x.modifiers)
      .filter((x): x is { id: string; name: string; price_cents: number } => x !== null),
  }))

  return {
    menu: items,
    tables: tables.data ?? [],
    floors: floors.data ?? [],
    categories: categories.data ?? [],
    customers: (customers.data ?? []) as PosCustomer[],
    staff: (staff.data ?? []) as PosStaff[],
    orders: (orders.data ?? []) as unknown as PosOrderCard[],
    kots: (kots.data ?? []) as unknown as PosKot[],
  }
}

/** One order, with the lines amend mode edits. Null when it isn't ours. */
export async function loadOrderDetail(
  orderId: string,
  tenantId: string,
): Promise<PosOrderDetail | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("orders")
    .select(ORDER_DETAIL_SELECT)
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .order("created_at", { referencedTable: "order_items" })
    .maybeSingle()
  return (data as unknown as PosOrderDetail) ?? null
}
