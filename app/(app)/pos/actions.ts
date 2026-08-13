"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"

export type PosState = { error: string } | { ok: true } | undefined

const ORDER_ROLES = ["owner", "manager", "cashier", "waiter"] as const

/** Off-menu line price ceiling. Mirrors the clamp in place_staff_order. */
const MAX_CUSTOM_PRICE_CENTS = 10_000_000

/** Both POS surfaces live on /pos now, so every mutation has to refresh it. */
function revalidatePos(orderId: string) {
  revalidatePath("/pos")
  revalidatePath(`/pos/${orderId}`)
}

export type AddItemOpts = {
  variantId?: string | null
  modifierIds?: string[]
  notes?: string | null
  course?: number | null
  seat?: number | null
  qty?: number
}

/**
 * Add a menu item to an open order.
 *
 * A thin wrapper over `amend_order_add_item` (migration 20260727090000). The
 * pricing rules — variant delta, `name (variant)` snapshot, modifier-link
 * validation, trusted modifier prices — live in that one SQL function, which
 * the Flutter app calls too. They used to live here *and* in
 * `place_staff_order`, with a comment that the two "must agree to the cent";
 * a third copy in Dart was the point at which that stopped being maintainable.
 *
 * The RPC also fixes what this function could not do in two round-trips: the
 * line and its `order_item_modifiers` now insert in one transaction, so a
 * failure between them can no longer leave a line priced for add-ons the
 * kitchen ticket never mentions.
 *
 * Signature and return shape are unchanged, so every caller stays put.
 */
export async function addItem(
  orderId: string,
  itemId: string,
  opts: AddItemOpts = {},
): Promise<PosState> {
  await requireRole(...ORDER_ROLES)
  const supabase = await createClient()

  const { error } = await supabase.rpc("amend_order_add_item", {
    _order_id: orderId,
    _item_id: itemId,
    _qty: Math.max(1, Math.floor(opts.qty ?? 1)),
    _variant_id: opts.variantId ?? undefined,
    _modifier_ids: opts.modifierIds?.length ? [...new Set(opts.modifierIds)] : undefined,
    _notes: opts.notes?.trim() || undefined,
    _course: opts.course ?? undefined,
    _seat: opts.seat ?? undefined,
  })
  if (error) return { error: friendlyAddItemError(error.message) }

  revalidatePos(orderId)
  return { ok: true }
}

/**
 * The RPC raises in SQL prose ("modifier not available for this item"). Keep
 * the wording the POS already showed for the cases staff actually hit.
 */
function friendlyAddItemError(message: string): string {
  if (message.includes("modifier not available")) {
    return "That add-on isn't available for this item."
  }
  if (message.includes("variant not found")) return "Variant not found."
  if (message.includes("item not found")) return "Item not found."
  if (message.includes("cannot be amended")) {
    return "This order is closed — it can't be changed."
  }
  return message
}

/** Change a line's quantity (min 1). Editable states only. */
export async function setLineQty(
  orderId: string,
  orderItemId: string,
  qty: number,
): Promise<PosState> {
  const tenant = await requireRole(...ORDER_ROLES)
  const next = Math.max(1, Math.floor(qty))
  const supabase = await createClient()
  const { error } = await supabase
    .from("order_items")
    .update({ qty: next })
    .eq("id", orderItemId)
    .eq("tenant_id", tenant.tenantId)
    .in("status", ["draft", "placed"])
  if (error) return { error: error.message }
  revalidatePos(orderId)
  return { ok: true }
}

/** Edit a line's notes / course / seat. */
export async function updateLine(
  orderId: string,
  orderItemId: string,
  fields: { notes?: string | null; course?: number | null; seat?: number | null },
): Promise<PosState> {
  const tenant = await requireRole(...ORDER_ROLES)
  const patch: Record<string, unknown> = {}
  if (fields.notes !== undefined) patch.notes = fields.notes?.trim() || null
  if (fields.course !== undefined) patch.course = fields.course
  if (fields.seat !== undefined) patch.seat = fields.seat
  if (Object.keys(patch).length === 0) return { ok: true }
  const supabase = await createClient()
  const { error } = await supabase
    .from("order_items")
    .update(patch)
    .eq("id", orderItemId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePos(orderId)
  return { ok: true }
}

/** Stage/unstage a line — held lines are not fired to the kitchen. */
export async function setLineHold(
  orderId: string,
  orderItemId: string,
  hold: boolean,
): Promise<PosState> {
  const tenant = await requireRole(...ORDER_ROLES)
  const supabase = await createClient()
  const { error } = await supabase
    .from("order_items")
    .update({ is_held: hold })
    .eq("id", orderItemId)
    .eq("tenant_id", tenant.tenantId)
    .in("status", ["draft", "placed"])
  if (error) return { error: error.message }
  revalidatePos(orderId)
  return { ok: true }
}

/** Void a line (manager approval + reason + audit + stock restore) via RPC. */
export async function voidLine(
  orderId: string,
  orderItemId: string,
  reason: string,
): Promise<PosState> {
  await requireRole(...ORDER_ROLES)
  if (!reason.trim()) return { error: "Void reason is required." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("void_order_item", {
    _order_item_id: orderItemId,
    _reason: reason.trim(),
  })
  if (error) return { error: error.message }
  revalidatePos(orderId)
  return { ok: true }
}

export async function removeItem(orderId: string, orderItemId: string): Promise<PosState> {
  const tenant = await requireRole(...ORDER_ROLES)
  const supabase = await createClient()
  const { error } = await supabase
    .from("order_items")
    .delete()
    .eq("id", orderItemId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePos(orderId)
  return { ok: true }
}

/**
 * One line of a composed order. Everything but `qty` is optional so that an
 * order queued by an older build — `{item_id, qty}` and nothing else — still
 * satisfies this type on replay. Don't make a field required without a queue
 * migration to match.
 *
 * A line is either a menu line (`item_id`) or a custom one (`custom_name` +
 * `unit_price_cents`). The server ignores any price sent for a menu line.
 */
export type PlaceLine = {
  item_id?: string | null
  qty: number
  variant_id?: string | null
  modifier_ids?: string[]
  notes?: string | null
  course?: number | null
  seat?: number | null
  custom_name?: string | null
  unit_price_cents?: number | null
}

/** Order-level details from the check-in panel. */
export type OrderMeta = {
  guests?: number | null
  waiterId?: string | null
  customerId?: string | null
  customerName?: string | null
  customerPhone?: string | null
}

/**
 * Place a complete order — destination, lines with variants/modifiers/notes,
 * and check-in details — atomically, under a client-supplied idempotency key.
 * This is also the offline-queue replay path; it dedups on
 * orders.unique(tenant_id, idempotency_key). Returns the order id.
 *
 * `meta` is defaulted rather than required so the existing replay call site
 * (components/offline-sync-provider.tsx) keeps working untouched.
 */
export async function placeStaffOrder(
  idempotencyKey: string,
  tableId: string | null,
  items: PlaceLine[],
  meta: OrderMeta = {},
): Promise<{ error: string } | { ok: true; orderId: string }> {
  const tenant = await requireRole(...ORDER_ROLES)
  if (!idempotencyKey) return { error: "Missing idempotency key." }
  if (!items?.length) return { error: "No items." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("place_staff_order", {
    _tenant: tenant.tenantId,
    _idempotency_key: idempotencyKey,
    _table_id: tableId,
    _order_type: tableId ? "dine_in" : "pickup",
    _items: items,
    _guests: meta.guests ?? undefined,
    _waiter: meta.waiterId ?? undefined,
    _customer: meta.customerId ?? undefined,
    _customer_name: meta.customerName ?? undefined,
    _customer_phone: meta.customerPhone ?? undefined,
  })
  if (error) return { error: error.message }

  revalidatePath("/pos")
  return { ok: true, orderId: data as string }
}

/**
 * Add an off-menu line to an existing order. addItem can't do this — it takes a
 * menu item id and re-reads its price. Here the price comes from the till, so
 * it's clamped and role-gated instead.
 */
export async function addCustomItem(
  orderId: string,
  fields: {
    name: string
    unitPriceCents: number
    qty?: number
    notes?: string | null
    course?: number | null
    seat?: number | null
  },
): Promise<PosState> {
  await requireRole(...ORDER_ROLES)
  const name = fields.name.trim()
  if (!name) return { error: "Give the item a name." }

  const price = Math.floor(fields.unitPriceCents)
  if (!Number.isFinite(price) || price < 0 || price > MAX_CUSTOM_PRICE_CENTS) {
    return { error: "That price looks wrong. Enter an amount between 0 and 100,000." }
  }

  // One trusted implementation, shared with the Flutter app.
  //
  // This used to insert into `order_items` directly behind the `requireRole`
  // above — but a role check inside a server action is not a guard: RLS on
  // `order_items` is tenant-scoped only, so the same row could be written
  // straight through PostgREST, with a price of the caller's choosing and no
  // audit row. The RPC re-checks the role AND `order.create`, refuses a billed
  // or closed order, clamps the price, and writes the `custom_price` audit in
  // the same transaction as the line.
  const supabase = await createClient()
  const { error } = await supabase.rpc("amend_order_add_custom_item", {
    _order_id: orderId,
    _name: name,
    _unit_price_cents: price,
    _qty: Math.max(1, Math.min(99, Math.floor(fields.qty ?? 1))),
    _notes: fields.notes?.trim() || null,
    _course: fields.course ?? null,
    _seat: fields.seat ?? null,
  })
  if (error) return { error: error.message }

  revalidatePos(orderId)
  return { ok: true }
}

/**
 * Set the check-in details on an existing order. Plain RLS-scoped writes — no
 * RPC needed here, because unlike place_staff_order this isn't SECURITY DEFINER,
 * so the tenant policies on orders/customers are already doing the guarding.
 */
export async function setOrderDetails(
  orderId: string,
  fields: OrderMeta,
): Promise<PosState> {
  const tenant = await requireRole(...ORDER_ROLES)
  const supabase = await createClient()

  const patch: Record<string, unknown> = {}

  if (fields.guests !== undefined) {
    if (fields.guests === null) {
      patch.guests = null
    } else {
      const guests = Math.floor(fields.guests)
      if (!Number.isFinite(guests) || guests < 1 || guests > 200) {
        return { error: "Guests must be between 1 and 200." }
      }
      patch.guests = guests
    }
  }
  if (fields.waiterId !== undefined) patch.waiter_id = fields.waiterId

  // Customer: an explicit id, else find-or-create by phone — same rule as
  // place_staff_order and attach_bill_customer.
  if (fields.customerId !== undefined) {
    patch.customer_id = fields.customerId
  } else {
    const name = fields.customerName?.trim() || null
    const phone = fields.customerPhone?.trim() || null
    if (name || phone) {
      let customerId: string | null = null
      if (phone) {
        const { data: found } = await supabase
          .from("customers")
          .select("id")
          .eq("tenant_id", tenant.tenantId)
          .eq("phone", phone)
          .limit(1)
          .maybeSingle()
        customerId = found?.id ?? null
      }
      if (!customerId) {
        const { data: created, error: custErr } = await supabase
          .from("customers")
          .insert({ tenant_id: tenant.tenantId, name: name ?? "Guest", phone })
          .select("id")
          .single()
        if (custErr || !created) return { error: custErr?.message ?? "Could not save the customer." }
        customerId = created.id
      }
      patch.customer_id = customerId
    }
  }

  if (Object.keys(patch).length === 0) return { ok: true }

  const { error } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", orderId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePos(orderId)
  return { ok: true }
}

/** Fire the order to the kitchen — splits into per-station KOTs (trusted fn). */
export async function fireOrder(
  orderId: string,
): Promise<{ error: string } | { ok: true; kotIds: string[] }> {
  const tenant = await requireRole(...ORDER_ROLES)
  const supabase = await createClient()
  const { error } = await supabase.rpc("fire_order", { _order_id: orderId })
  if (error) return { error: error.message }
  // Re-query the freshly created tickets so the client can print them. Scope to
  // unprinted + unbumped so a re-fire (added items) won't reprint earlier KOTs.
  const { data: kots } = await supabase
    .from("kots")
    .select("id")
    .eq("tenant_id", tenant.tenantId)
    .eq("order_id", orderId)
    .eq("status", "new")
    .is("printed_at", null)
  revalidatePos(orderId)
  return { ok: true, kotIds: (kots ?? []).map((k) => k.id) }
}

/** Cancel a whole order (manager approval + reason + audit + stock restore) via RPC. */
export async function cancelOrder(orderId: string, reason: string): Promise<PosState> {
  await requireRole(...ORDER_ROLES)
  if (!reason.trim()) return { error: "Cancel reason is required." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancel_order", {
    _order_id: orderId,
    _reason: reason.trim(),
  })
  if (error) return { error: error.message }
  revalidatePos(orderId)
  return { ok: true }
}

/** Pin (or unpin) an order so it sorts to the top of the POS board. */
export async function pinOrder(orderId: string, pinned: boolean): Promise<PosState> {
  const tenant = await requireRole(...ORDER_ROLES)
  const supabase = await createClient()
  const { error } = await supabase
    .from("orders")
    .update({ pinned_at: pinned ? new Date().toISOString() : null })
    .eq("id", orderId)
    .eq("tenant_id", tenant.tenantId)
  if (error) return { error: error.message }
  revalidatePos(orderId)
  return { ok: true }
}

/**
 * Type-ahead over the whole customer book. loadPosData ships only the first 200
 * to the till (an unbounded select would hand every device the entire CRM); this
 * searches the rest on demand by name or phone. Returns at most 20 matches.
 */
export async function searchCustomers(
  query: string,
): Promise<{ id: string; name: string | null; phone: string | null }[]> {
  const tenant = await requireRole(...ORDER_ROLES)
  // Strip the chars that terminate PostgREST's or()/ilike grammar, then escape
  // LIKE wildcards so a literal % or _ in the query isn't treated as a pattern.
  const q = query.trim().replace(/[,()"]/g, "")
  if (q.length < 2) return []
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
  const supabase = await createClient()
  const { data } = await supabase
    .from("customers")
    .select("id, name, phone")
    .eq("tenant_id", tenant.tenantId)
    .or(`name.ilike.${like},phone.ilike.${like}`)
    .order("name")
    .limit(20)
  return data ?? []
}

/** KOT ids for an order, so the card can reprint its kitchen slips. */
export async function listOrderKotIds(
  orderId: string,
): Promise<{ error: string } | { ok: true; kotIds: string[] }> {
  const tenant = await requireRole(...ORDER_ROLES)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("kots")
    .select("id")
    .eq("tenant_id", tenant.tenantId)
    .eq("order_id", orderId)
  if (error) return { error: error.message }
  return { ok: true, kotIds: (data ?? []).map((k) => k.id) }
}
