import { cache } from "react"
import { createClient } from "@/lib/supabase/server"

/** The signed-in user's full permission-key set for a tenant (custom role or
 * base-role default; all keys for platform admins). Cached per request — the
 * layout's sidebar and the page's `requirePermission` guard both want it. */
export const getMyPermissions = cache(async (tenantId: string): Promise<string[]> => {
  const supabase = await createClient()
  const { data } = await supabase.rpc("get_my_permissions", { _tenant: tenantId })
  if (!data) return []
  return (data as unknown[]).map((r) =>
    typeof r === "string" ? r : String(Object.values(r as object)[0]),
  )
})
