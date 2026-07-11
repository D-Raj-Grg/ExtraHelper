"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

/**
 * Invisible helper: subscribes to Supabase Realtime `postgres_changes` for the
 * given tables (tenant-scoped) and calls `router.refresh()` on any change, so a
 * server-rendered list stays live. A 30s poll backs it up if the socket drops.
 * Same pattern as the KDS board — reused across POS, tables, etc.
 */
export function RealtimeRefresh({
  channel,
  tenantId,
  tables,
}: {
  channel: string
  tenantId: string
  tables: string[]
}) {
  const router = useRouter()

  useEffect(() => {
    const safety = setInterval(() => router.refresh(), 30000)
    return () => clearInterval(safety)
  }, [router])

  useEffect(() => {
    const supabase = createClient()
    const filter = `tenant_id=eq.${tenantId}`
    let ch = supabase.channel(`${channel}:${tenantId}`)
    for (const table of tables) {
      ch = ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter },
        () => router.refresh(),
      )
    }
    ch.subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
    // tables is a stable literal per call site; join for dep identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, channel, tenantId, tables.join(",")])

  return null
}
