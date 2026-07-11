import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

/**
 * Server Supabase client (Server Components, Server Actions, Route Handlers).
 * `cookies()` is async in Next 16 — must be awaited before creating the client.
 * Uses the publishable (anon) key; RLS enforces tenant isolation. Never use the
 * service role key here — that belongs only in trusted server-only edge functions.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // `setAll` called from a Server Component — safe to ignore when the
            // session is refreshed by proxy.ts. Otherwise a Server Action/Route
            // Handler catches this and persists cookies correctly.
          }
        },
      },
    },
  )
}
