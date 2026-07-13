"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

/**
 * Refreshes the current route whenever this tenant's menu_items change — used on
 * ordering surfaces so an 86 (out-of-stock) toggle live-disables the item.
 */
export function MenuRealtimeRefresh({ tenantId }: { tenantId: string }) {
  const router = useRouter()
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`menu:${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_items", filter: `tenant_id=eq.${tenantId}` },
        () => router.refresh(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [tenantId, router])
  return null
}
