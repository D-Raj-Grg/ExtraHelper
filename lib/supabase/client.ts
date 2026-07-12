import { createBrowserClient } from "@supabase/ssr"

/**
 * Browser Supabase client (Client Components) — a module singleton so the whole
 * app shares ONE Realtime WebSocket. Uses the publishable (anon) key; RLS is the
 * isolation boundary. The Realtime socket is authenticated with the user's JWT
 * by <RealtimeAuth> (see components/realtime-auth.tsx) — required for
 * postgres_changes on RLS tables to deliver events.
 */
let client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (client) return client
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
  return client
}
