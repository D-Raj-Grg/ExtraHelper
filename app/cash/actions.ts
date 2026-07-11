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
