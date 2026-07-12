"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { formatDateTime } from "@/lib/format"
import { ACTION_STYLES } from "@/lib/audit-constants"
import { Button } from "@/components/ui/button"

type OrderRow = {
  id: string
  order_type: string
  status: string
  created_at: string
  restaurant_tables: { label: string } | null
}
type ActivityRow = {
  id: string
  action: string
  entity_type: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

const ORDER_STATUS_STYLES: Record<string, string> = {
  placed: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  draft: "bg-muted text-muted-foreground",
  in_kitchen: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  preparing: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  ready: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  served: "bg-green-500/10 text-green-600 dark:text-green-400",
  billed: "bg-green-500/10 text-green-600 dark:text-green-400",
  closed: "bg-muted text-muted-foreground",
  cancelled: "bg-red-500/10 text-red-600 dark:text-red-400",
}

const ORDER_SELECT =
  "id, order_type, status, created_at, restaurant_tables!orders_table_id_fkey(label)"

export function NotificationTabs({
  orders,
  activity,
  tenantId,
  timezone,
  canSeeActivity,
}: {
  orders: OrderRow[]
  activity: ActivityRow[] | null
  tenantId: string
  timezone: string
  canSeeActivity: boolean
}) {
  const [tab, setTab] = useState<"order" | "activity">("order")

  // Order tab kept live via Realtime (scoped debounced refetch).
  const [liveOrders, setLiveOrders] = useState<OrderRow[]>(orders)
  useEffect(() => setLiveOrders(orders), [orders])

  const refetch = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(50)
    if (data) setLiveOrders(data as unknown as OrderRow[])
  }, [tenantId])

  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const ping = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refetch(), 200)
    }
    const channel = supabase
      .channel(`notif-orders:${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `tenant_id=eq.${tenantId}` },
        ping,
      )
      .subscribe()
    const safety = setInterval(() => void refetch(), 45000)
    return () => {
      if (timer) clearTimeout(timer)
      clearInterval(safety)
      void supabase.removeChannel(channel)
    }
  }, [tenantId, refetch])

  // Activity tab — also live (audit_logs realtime; RLS delivers only to
  // owner/manager, so only subscribe when the tab is available).
  const [liveActivity, setLiveActivity] = useState<ActivityRow[]>(activity ?? [])
  useEffect(() => setLiveActivity(activity ?? []), [activity])

  const refetchActivity = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from("audit_logs")
      .select("id, action, entity_type, metadata, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100)
    if (data) setLiveActivity(data as unknown as ActivityRow[])
  }, [tenantId])

  useEffect(() => {
    if (!canSeeActivity) return
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const ping = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refetchActivity(), 200)
    }
    const channel = supabase
      .channel(`notif-activity:${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "audit_logs", filter: `tenant_id=eq.${tenantId}` },
        ping,
      )
      .subscribe()
    const safety = setInterval(() => void refetchActivity(), 45000)
    return () => {
      if (timer) clearTimeout(timer)
      clearInterval(safety)
      void supabase.removeChannel(channel)
    }
  }, [tenantId, canSeeActivity, refetchActivity])

  return (
    <div>
      {/* Tabs */}
      <div className="mb-4 inline-flex rounded-lg bg-muted p-1 text-sm">
        <button
          type="button"
          onClick={() => setTab("order")}
          className={`rounded-md px-4 py-1.5 font-medium ${
            tab === "order" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          Order
        </button>
        {canSeeActivity ? (
          <button
            type="button"
            onClick={() => setTab("activity")}
            className={`rounded-md px-4 py-1.5 font-medium ${
              tab === "activity" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            Activity
          </button>
        ) : null}
      </div>

      {tab === "order" ? (
        liveOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {liveOrders.map((o) => (
              <li
                key={o.id}
                className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${
                  o.status === "placed" ? "bg-amber-500/5" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {o.restaurant_tables?.label ? `Table ${o.restaurant_tables.label}` : "Takeaway"}
                    </span>
                    <span className="text-xs capitalize text-muted-foreground">
                      {o.order_type.replace("_", " ")}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        ORDER_STATUS_STYLES[o.status] ?? "bg-muted"
                      }`}
                    >
                      {o.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateTime(o.created_at, timezone)}
                  </p>
                </div>
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/pos/${o.id}`} />}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ActivityList activity={liveActivity} timezone={timezone} />
      )}
    </div>
  )
}

function ActivityList({ activity, timezone }: { activity: ActivityRow[]; timezone: string }) {
  if (activity.length === 0)
    return <p className="text-sm text-muted-foreground">No activity yet.</p>
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {activity.map((r) => (
        <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_STYLES[r.action] ?? "bg-muted"}`}
              >
                {r.action.replace(/_/g, " ")}
              </span>
              <span className="text-xs text-muted-foreground">{r.entity_type ?? "—"}</span>
            </div>
            {r.metadata && Object.keys(r.metadata).length > 0 ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {Object.entries(r.metadata)
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatDateTime(r.created_at, timezone)}
          </span>
        </li>
      ))}
    </ul>
  )
}
