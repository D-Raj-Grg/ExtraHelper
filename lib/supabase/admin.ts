import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase/database.types"

/**
 * Service-role client — bypasses RLS and can write auth users. Server Actions
 * and route handlers only, and only AFTER an authorization RPC has run under the
 * caller's JWT: this client knows nothing about who is asking. Never import it
 * from a client module (the key is not NEXT_PUBLIC_, so it would be undefined
 * there anyway — but the import alone is a mistake worth failing on).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
