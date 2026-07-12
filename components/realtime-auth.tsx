"use client"

import { useEffect } from "react"
import type { Session } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"

/**
 * Authenticates the shared Realtime socket with the user's JWT. Without this the
 * socket is `anon` and RLS filters out every postgres_changes event (nothing is
 * delivered). Re-auths on token refresh so the socket stays authorized. Mount
 * once, above any component that subscribes to Realtime.
 */
export function RealtimeAuth() {
  useEffect(() => {
    const supabase = createClient()
    let active = true

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      const token = data.session?.access_token
      if (active && token) supabase.realtime.setAuth(token)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return null
}
