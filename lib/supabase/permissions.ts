import { createClient } from "@/lib/supabase/server"

/** The signed-in user's full permission-key set for a tenant (custom role or
 * base-role default; all keys for platform admins). */
export async function getMyPermissions(tenantId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("get_my_permissions", { _tenant: tenantId })
  if (!data) return []
  return (data as unknown[]).map((r) =>
    typeof r === "string" ? r : String(Object.values(r as object)[0]),
  )
}
