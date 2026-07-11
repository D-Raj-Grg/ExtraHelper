"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import type { KotStatus } from "@/lib/kds-constants"

export type KdsState = { error: string } | { ok: true } | undefined

/** Advance (bump) a KOT ticket + its items to a new status. */
export async function bumpKot(kotId: string, status: KotStatus): Promise<KdsState> {
  await requireRole("owner", "manager", "kitchen")
  const supabase = await createClient()

  const { error } = await supabase.from("kots").update({ status }).eq("id", kotId)
  if (error) return { error: error.message }
  // Keep item statuses in step with the ticket.
  await supabase.from("kot_items").update({ status }).eq("kot_id", kotId)

  revalidatePath("/kds")
  return { ok: true }
}
