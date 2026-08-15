"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { RESV_STATES, type ResvStatus } from "@/lib/reservation-constants"
import { zonedTimeToUtc } from "@/lib/format"

/** What the host typed, echoed back so a rejected booking isn't retyped. */
export type ResvDraft = {
  name: string
  phone: string
  party: string
  when: string
  tableId: string
  notes: string
}

/**
 * `id` is the new reservation's — the form keys itself on it to remount (and so
 * clear) after a booking. A plain `{ok:true}` can't do that job: two bookings in
 * a row have to produce two different keys. The error case carries the draft,
 * because that same remount would otherwise wipe what the host just typed.
 */
export type ResvState =
  | { error: string; draft: ResvDraft }
  | { ok: true; id?: string }
  | undefined

const RESV_ROLES = ["owner", "manager", "receptionist"] as const

export async function createReservation(
  _prev: ResvState,
  formData: FormData,
): Promise<ResvState> {
  const tenant = await requireRole(...RESV_ROLES)
  const name = String(formData.get("name") ?? "").trim()
  const phone = String(formData.get("phone") ?? "").trim() || null
  const party = Number(formData.get("party") ?? 0)
  const when = String(formData.get("when") ?? "").trim()
  const tableId = String(formData.get("tableId") ?? "").trim() || null
  const notes = String(formData.get("notes") ?? "").trim() || null

  const draft: ResvDraft = {
    name,
    phone: phone ?? "",
    party: String(formData.get("party") ?? ""),
    when,
    tableId: tableId ?? "",
    notes: notes ?? "",
  }
  const fail = (error: string): ResvState => ({ error, draft })

  if (!name) return fail("Guest name is required.")
  if (!Number.isInteger(party) || party < 1) return fail("Party size must be at least 1.")
  if (!when) return fail("Pick a date and time.")
  // The datetime-local value is a naive wall time; interpret it in the tenant's
  // timezone (not the server's UTC) so 7pm entered = 7pm shown.
  const reservedAt = zonedTimeToUtc(when, tenant.timezone)
  if (Number.isNaN(reservedAt.getTime())) return fail("Invalid date/time.")

  const supabase = await createClient()
  // Lightweight customer record (reused by loyalty/CRM later).
  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .insert({ tenant_id: tenant.tenantId, name, phone })
    .select("id")
    .single()
  if (custErr || !customer) return fail(custErr?.message ?? "Could not save guest.")

  const { data: created, error } = await supabase.from("reservations").insert({
    tenant_id: tenant.tenantId,
    table_id: tableId,
    customer_id: customer.id,
    party_size: party,
    reserved_at: reservedAt.toISOString(),
    status: "pending",
    notes,
  }).select("id").single()
  if (error) return fail(error.message)

  revalidatePath("/reservations")
  return { ok: true, id: created?.id }
}

export type StatusResult = { error: string } | { ok: true }

/** Advance a reservation's status. Seating also occupies the linked table. */
export async function setReservationStatus(
  id: string,
  status: ResvStatus,
): Promise<StatusResult> {
  const tenant = await requireRole(...RESV_ROLES)
  if (!RESV_STATES.includes(status)) return { error: "Invalid status." }

  const supabase = await createClient()
  // Scope to the active tenant: RLS already blocks cross-tenant rows, but this
  // also prevents a multi-tenant user touching a non-active tenant's rows.
  const { data: resv, error: readErr } = await supabase
    .from("reservations")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", tenant.tenantId)
    .select("table_id")
    .single()
  if (readErr) return { error: readErr.message }

  if (status === "seated" && resv?.table_id) {
    await supabase
      .from("restaurant_tables")
      .update({ state: "occupied" })
      .eq("id", resv.table_id)
      .eq("tenant_id", tenant.tenantId)
  }

  revalidatePath("/reservations")
  return { ok: true }
}
