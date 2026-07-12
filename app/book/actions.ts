"use server"

import { createClient } from "@/lib/supabase/server"
import { zonedTimeToUtc } from "@/lib/format"

export type BookState = { error: string } | { ok: true } | undefined

export async function bookPublic(
  slug: string,
  _prev: BookState,
  formData: FormData,
): Promise<BookState> {
  const name = String(formData.get("name") ?? "").trim()
  const phone = String(formData.get("phone") ?? "").trim() || null
  const party = Number(formData.get("party") ?? 0)
  const when = String(formData.get("when") ?? "").trim()
  const tz = String(formData.get("tz") ?? "").trim() || "UTC"
  const notes = String(formData.get("notes") ?? "").trim() || null

  if (!name) return { error: "Name is required." }
  if (!Number.isInteger(party) || party < 1) return { error: "Party size must be at least 1." }
  // Naive wall time → the restaurant's timezone (not the visitor's browser zone).
  const reservedAt = zonedTimeToUtc(when, tz)
  if (!when || Number.isNaN(reservedAt.getTime())) return { error: "Pick a date and time." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_public_reservation", {
    _slug: slug,
    _name: name,
    _phone: phone,
    _party: party,
    _when: reservedAt.toISOString(),
    _notes: notes,
  })
  if (error) return { error: error.message }
  return { ok: true }
}
