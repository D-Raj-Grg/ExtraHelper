"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { BellIcon } from "lucide-react"
import { toast } from "sonner"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { useRequiredTenant } from "@/components/tenant-provider"

type OrderRow = { status?: string }

/**
 * Header bell: live count of orders awaiting acknowledgement (status 'placed',
 * incl. QR self-orders). New order → badge + toast; opening/firing it (status
 * advances) auto-clears. Realtime off the shared authed socket.
 */
const ALLOWED = ["owner", "manager", "cashier", "waiter"]

export function NotificationBell() {
  const { tenantId, role } = useRequiredTenant()
  const allowed = ALLOWED.includes(role)
  const [count, setCount] = useState(0)

  const refetch = useCallback(async () => {
    const supabase = createClient()
    const { count: c } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "placed")
    setCount(c ?? 0)
  }, [tenantId])

  useEffect(() => {
    if (allowed) void refetch()
  }, [allowed, refetch])

  useEffect(() => {
    if (!allowed) return
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const ping = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refetch(), 200)
    }
    const channel = supabase
      .channel(`notifications:${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `tenant_id=eq.${tenantId}` },
        (payload: RealtimePostgresChangesPayload<OrderRow>) => {
          const n = payload.new as OrderRow
          const o = payload.old as OrderRow
          // Toast when an order enters 'placed' — a QR insert, or a draft that
          // gets placed.
          const enteredPlaced =
            (payload.eventType === "INSERT" && n?.status === "placed") ||
            (payload.eventType === "UPDATE" && n?.status === "placed" && o?.status !== "placed")
          if (enteredPlaced) toast("New order received")
          ping()
        },
      )
      .subscribe()
    const safety = setInterval(() => void refetch(), 45000)
    return () => {
      if (timer) clearTimeout(timer)
      clearInterval(safety)
      void supabase.removeChannel(channel)
    }
  }, [tenantId, allowed, refetch])

  if (!allowed) return null

  return (
    <Link
      href="/notifications"
      className="relative flex size-8 items-center justify-center rounded-md hover:bg-accent"
      aria-label={count > 0 ? `Notifications (${count} new)` : "Notifications"}
      title="Notifications"
    >
      <BellIcon className="size-4" />
      {count > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  )
}
