import { cache } from "react"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"

/**
 * The signed-in user, resolved once per request.
 *
 * `supabase.auth.getUser()` is a network call to the Auth server on every
 * invocation — it validates the JWT rather than trusting the cookie. The app
 * layout alone used to make five of them (auth check, tenant, preferences,
 * memberships, profile) and each page guard added two more, all serial. React's
 * `cache()` dedupes them to one per request render pass; the validation
 * guarantee is unchanged because the underlying call still happens, just once.
 *
 * Per-request only — `cache()` does not leak a user across requests.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})
