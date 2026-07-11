import { createClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/supabase/guards"
import {
  DEFAULT_SCALE,
  DEFAULT_THEME,
  clampScale,
  type Theme,
} from "@/lib/preferences-constants"

export type UserPreferences = { theme: Theme; scale: number }

/**
 * The signed-in user's UI preferences (theme + text scale), falling back to
 * defaults when no row exists yet. Own-row only — enforced by RLS.
 */
export async function getUserPreferences(): Promise<UserPreferences> {
  const user = await requireUser()
  const supabase = await createClient()
  const { data } = await supabase
    .from("user_preferences")
    .select("theme, text_scale")
    .eq("user_id", user.id)
    .maybeSingle()

  return {
    theme: data?.theme === "dark" ? "dark" : DEFAULT_THEME,
    scale: data ? clampScale(data.text_scale) : DEFAULT_SCALE,
  }
}
