"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"

export type CashState = { error: string } | { ok: true } | undefined

const CASH_ROLES = ["owner", "manager", "cashier"] as const

/** Open a cash drawer session with an opening float (in dollars). */
export async function openSession(
  _prev: CashState,
  formData: FormData,
): Promise<CashState> {
  const tenant = await requireRole(...CASH_ROLES)
  const floatCents = Math.round(Number(formData.get("float") ?? 0) * 100)
  if (!Number.isFinite(floatCents) || floatCents < 0)
    return { error: "Opening float must be zero or positive." }

  const supabase = await createClient()
  // Branch left null → reconcile the whole tenant's cash (single-branch default).
  const { error } = await supabase.rpc("open_cash_session", {
    _tenant: tenant.tenantId,
    _branch_id: null,
    _opening_float_cents: floatCents,
  })
  if (error) return { error: error.message }

  revalidatePath("/cash")
  return { ok: true }
}

/** Close a session: reconciles counted vs expected (trusted SQL). */
export async function closeSession(
  _prev: CashState,
  formData: FormData,
): Promise<CashState> {
  await requireRole(...CASH_ROLES)
  const sessionId = String(formData.get("sessionId") ?? "")
  const countedCents = Math.round(Number(formData.get("counted") ?? 0) * 100)
  if (!sessionId) return { error: "No open session." }
  if (!Number.isFinite(countedCents) || countedCents < 0)
    return { error: "Counted amount must be zero or positive." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("close_cash_session", {
    _session_id: sessionId,
    _counted_cents: countedCents,
  })
  if (error) return { error: error.message }

  revalidatePath("/cash")
  return { ok: true }
}

const MOVEMENT_KINDS = ["payout", "paid_in"] as const
const MOVEMENT_CATEGORIES = [
  "supplier",
  "supplies",
  "utilities",
  "staff_advance",
  "transport",
  "other",
] as const

type MovementKind = (typeof MOVEMENT_KINDS)[number]
type MovementCategory = (typeof MOVEMENT_CATEGORIES)[number]

/**
 * Record cash leaving or entering the drawer, against the caller's open session.
 * Lands as `pending` — a manager reviews it, and the close auto-approves
 * whatever is still outstanding so nobody is stranded at the end of a shift.
 */
export async function recordMovement(
  _prev: CashState,
  formData: FormData,
): Promise<CashState> {
  await requireRole(...CASH_ROLES)
  const kind = String(formData.get("kind") ?? "")
  const category = String(formData.get("category") ?? "")
  const note = String(formData.get("note") ?? "").trim()
  const amountCents = Math.round(Number(formData.get("amount") ?? 0) * 100)

  if (!MOVEMENT_KINDS.includes(kind as MovementKind))
    return { error: "Pick cash out or cash in." }
  if (!MOVEMENT_CATEGORIES.includes(category as MovementCategory))
    return { error: "Pick a category." }
  if (!note) return { error: "Say what this was for." }
  if (!Number.isFinite(amountCents) || amountCents <= 0)
    return { error: "Amount must be more than zero." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("record_cash_movement", {
    _kind: kind as MovementKind,
    _category: category as MovementCategory,
    _amount_cents: amountCents,
    _note: note,
  })
  if (error) return { error: error.message }

  revalidatePath("/cash")
  return { ok: true }
}

/** Approve and reject are the same transition; only the RPC differs. */
async function setMovementStatus(
  formData: FormData,
  rpc: "approve_cash_movement" | "reject_cash_movement",
): Promise<CashState> {
  await requireRole("owner", "manager")
  const id = String(formData.get("movementId") ?? "")
  if (!id) return { error: "No movement selected." }

  const supabase = await createClient()
  const { error } = await supabase.rpc(rpc, { _id: id })
  if (error) return { error: error.message }

  revalidatePath("/cash")
  return { ok: true }
}

export async function approveMovement(_prev: CashState, formData: FormData): Promise<CashState> {
  return setMovementStatus(formData, "approve_cash_movement")
}

export async function rejectMovement(_prev: CashState, formData: FormData): Promise<CashState> {
  return setMovementStatus(formData, "reject_cash_movement")
}
