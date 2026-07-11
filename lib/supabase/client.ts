import { createBrowserClient } from "@supabase/ssr"

/**
 * Browser Supabase client (Client Components).
 * Uses the publishable (anon) key — safe to expose. RLS is the isolation boundary.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
