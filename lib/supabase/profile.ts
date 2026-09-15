import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/supabase/user"

export type Profile = {
  id: string
  fullName: string | null
  username: string | null
  avatarUrl: string | null
  email: string | null
}

/** The signed-in user's profile (display name / @handle / avatar). Null if not signed in. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getCurrentUser()
  if (!user) return null
  const supabase = await createClient()

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .eq("id", user.id)
    .maybeSingle()

  return {
    id: user.id,
    fullName: data?.full_name ?? null,
    username: data?.username ?? null,
    avatarUrl: data?.avatar_url ?? null,
    email: user.email ?? null,
  }
})
