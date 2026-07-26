"use client"

import { useEffect, useRef } from "react"

import { createClient } from "@/lib/supabase/client"

/**
 * One Realtime channel per tenant, shared by the order grid and whatever the
 * modal has open. Subscribing per component would open a socket channel per
 * mount and hand the same event to each of them.
 *
 * The socket carries the JWT via <RealtimeAuth /> — without it RLS drops every
 * event and this goes quiet with no error. Don't create a second client here.
 *
 * The 150ms debounce coalesces the burst you get from one order write (orders +
 * n × order_items). The 45s interval is a safety net for a dropped socket.
 */
export function usePosRealtime(tenantId: string, onPing: () => void) {
  // Held in a ref so a caller passing an inline closure doesn't tear the
  // channel down and rebuild it on every render.
  const cb = useRef(onPing)
  useEffect(() => {
    cb.current = onPing
  }, [onPing])

  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const ping = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => cb.current(), 150)
    }
    const filter = `tenant_id=eq.${tenantId}`
    const channel = supabase
      .channel(`pos:${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter }, ping)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter }, ping)
      .subscribe()
    const safety = setInterval(() => cb.current(), 45000)
    return () => {
      if (timer) clearTimeout(timer)
      clearInterval(safety)
      void supabase.removeChannel(channel)
    }
  }, [tenantId])
}
