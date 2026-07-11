"use server"

import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/supabase/guards"
import {
  SCALE_COOKIE,
  THEME_COOKIE,
  clampScale,
  type Theme,
} from "@/lib/preferences-constants"

const YEAR = 60 * 60 * 24 * 365

/**
 * Persist the current user's appearance preferences to the DB (source of truth,
 * follows them across devices) and mirror to cookies so the root layout paints
 * the correct theme + text scale on first load with no flash.
 */
export async function savePreferences(theme: Theme, scale: number) {
  const user = await requireUser()
  const nextTheme: Theme = theme === "dark" ? "dark" : "light"
  const nextScale = clampScale(scale)

  const supabase = await createClient()
  await supabase.from("user_preferences").upsert(
    { user_id: user.id, theme: nextTheme, text_scale: nextScale },
    { onConflict: "user_id" },
  )

  const store = await cookies()
  const opts = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: YEAR }
  store.set(THEME_COOKIE, nextTheme, opts)
  store.set(SCALE_COOKIE, String(nextScale), opts)
}
