"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requirePermission, requireRole } from "@/lib/supabase/guards"
import type { KotStatus } from "@/lib/kds-constants"

export type KdsState = { error: string } | { ok: true } | undefined

/**
 * Advance (bump) a KOT ticket + its live items to a new status.
 *
 * Thin wrapper over `set_kot_status`. It used to update `kots` and `kot_items`
 * directly, which meant the only guard was the `requireRole` above it — and RLS
 * on both tables is tenant-scoped only, so any member could bump any ticket
 * through the API. The rule lives in Postgres now, where the Flutter kitchen
 * board reaches it too.
 */
export async function bumpKot(kotId: string, status: KotStatus): Promise<KdsState> {
  await requirePermission("kds.bump")
  const supabase = await createClient()

  const { error } = await supabase.rpc("set_kot_status", {
    _kot_id: kotId,
    _status: status,
  })
  if (error) return { error: error.message }

  revalidatePath("/kds")
  // The POS KOT tab reads the same tickets — keep its server-seeded list fresh.
  revalidatePath("/pos")
  return { ok: true }
}

/**
 * Set one dish's status. The RPC derives the ticket from its lines and the
 * order from its tickets, so a cook can plate dish by dish without the ticket
 * lying about where the order is.
 */
export async function setKotItemStatus(
  kotItemId: string,
  status: KotStatus,
): Promise<KdsState> {
  await requirePermission("kds.bump")
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_kot_item_status", {
    _kot_item_id: kotItemId,
    _status: status,
  })
  if (error) return { error: error.message }
  revalidatePath("/kds")
  revalidatePath("/pos")
  return { ok: true }
}

/** Waiter marks an order delivered — advances order + tickets to served. */
export async function markServed(orderId: string): Promise<KdsState> {
  await requireRole("owner", "manager", "kitchen", "waiter", "cashier")
  const supabase = await createClient()
  const { error } = await supabase.rpc("mark_order_served", { _order_id: orderId })
  if (error) return { error: error.message }
  revalidatePath("/kds")
  revalidatePath("/pos")
  return { ok: true }
}

/** Stamp a KOT as printed (fed by the browser print view). Idempotent-ish. */
export async function markKotPrinted(kotId: string): Promise<KdsState> {
  await requirePermission("kds.view")
  const supabase = await createClient()
  const { error } = await supabase.rpc("mark_kot_printed", { _kot_id: kotId })
  if (error) return { error: error.message }
  return { ok: true }
}

/**
 * Recall a bumped ticket back onto the board.
 *
 * Now writes the `recalled` status rather than `preparing`. The old direct
 * update made `recalled` unreachable, so `mark_order_served`'s
 * `status <> 'recalled'` exclusion never fired and a ticket pulled back could
 * be swept to served underneath the cook. The RPC also audits it.
 */
export async function recallKot(kotId: string): Promise<KdsState> {
  await requirePermission("kds.bump")
  const supabase = await createClient()

  const { error } = await supabase.rpc("recall_kot", { _kot_id: kotId })
  if (error) return { error: error.message }

  revalidatePath("/kds")
  revalidatePath("/pos")
  return { ok: true }
}
