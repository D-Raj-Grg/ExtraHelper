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
  // One RPC finds-or-creates the guest (by phone, so a regular isn't duplicated
  // on every booking) and books the table, and the mobile app calls the same
  // one — the rules live in Postgres, not here.
  const { data: id, error } = await supabase.rpc("create_reservation", {
    _tenant: tenant.tenantId,
    _name: name,
    _phone: phone,
    _party: party,
    _when: reservedAt.toISOString(),
    _table_id: tableId,
    _notes: notes,
  })
  if (error) return fail(error.message)

  revalidatePath("/reservations")
  return { ok: true, id: id ?? undefined }
}

export type StatusResult = { error: string } | { ok: true }

/** Advance a reservation's status. Seating also occupies the linked table (in the RPC). */
export async function setReservationStatus(
  id: string,
  status: ResvStatus,
): Promise<StatusResult> {
  await requireRole(...RESV_ROLES)
  if (!RESV_STATES.includes(status)) return { error: "Invalid status." }

  const supabase = await createClient()
  // `set_reservation_status` owns the rules: which moves are legal (a seated
  // party can't be cancelled), occupying the table on seat, the audit row, and
  // the tenant check. A role check in this action never stopped the same update
  // going through the API.
  const { error } = await supabase.rpc("set_reservation_status", {
    _id: id,
    _status: status,
  })
  if (error) return { error: error.message }

  revalidatePath("/reservations")
  return { ok: true }
}
