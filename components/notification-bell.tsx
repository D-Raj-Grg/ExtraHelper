"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { BellIcon, InboxIcon } from "lucide-react"
import { toast } from "sonner"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"

import { createClient } from "@/lib/supabase/client"
import { useRequiredTenant } from "@/components/tenant-provider"
import { useIsMobile } from "@/hooks/use-mobile"
import { minuteNow, subscribeMinute } from "@/lib/clock"
import { relativeTime } from "@/lib/format"
import { ORDER_STATUS_STYLE, orderStatusLabel, orderTypeLabel } from "@/lib/order-constants"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

type OrderRow = {
  id: string
  order_type: string
  status: string
  created_at: string
  restaurant_tables: { label: string } | null
}

/**
 * Header bell: live count of orders awaiting acknowledgement (status 'placed',
 * incl. QR self-orders). New order → badge + toast; opening/firing it (status
 * advances) auto-clears. Realtime off the shared authed socket.
 *
 * Clicking it opens a quick view of the latest orders rather than navigating —
 * mid-service, glancing at the bell shouldn't cost you the screen you're on.
 * Desktop gets a popover, phones a bottom sheet (a 288px popover anchored to a
 * header icon is unreachable one-handed). "View all" goes to /notifications,
 * which keeps the full history and the activity tab.
 */
const ALLOWED = ["owner", "manager", "cashier", "waiter"]

/** Rows in the quick view. The full list lives on /notifications. */
const PREVIEW_LIMIT = 6

const ORDER_SELECT =
  "id, order_type, status, created_at, restaurant_tables!orders_table_id_fkey(label)"

export function NotificationBell() {
  const { tenantId, role, timezone } = useRequiredTenant()
  const allowed = ALLOWED.includes(role)
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [recent, setRecent] = useState<OrderRow[] | null>(null)

  const refetch = useCallback(async () => {
    const supabase = createClient()
    const [{ count: c }, { data }] = await Promise.all([
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "placed"),
      supabase
        .from("orders")
        .select(ORDER_SELECT)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(PREVIEW_LIMIT),
    ])
    setCount(c ?? 0)
    setRecent((data ?? []) as unknown as OrderRow[])
  }, [tenantId])

  useEffect(() => {
    if (!allowed) return
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const ping = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refetch(), 200)
    }
    // First load rides along with the subscription, debounced like every other
    // refetch so state only ever lands from a callback, never synchronously in
    // the effect body.
    ping()
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

  const label = count > 0 ? `Notifications (${count} new)` : "Notifications"
  const trigger = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="relative"
      aria-label={label}
      title="Notifications"
    >
      <BellIcon />
      {count > 0 ? (
        <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Button>
  )

  const panel = (
    <NotificationPanel
      orders={recent}
      timezone={timezone}
      onNavigate={() => setOpen(false)}
    />
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={trigger} />
        <SheetContent side="bottom" className="max-h-[80vh] gap-0 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>Notifications</SheetTitle>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="end" className="w-88 overflow-hidden p-0">
        <div className="border-b px-4 py-2.5">
          <p className="font-heading text-sm font-medium">Notifications</p>
        </div>
        {panel}
      </PopoverContent>
    </Popover>
  )
}

function NotificationPanel({
  orders,
  timezone,
  onNavigate,
}: {
  orders: OrderRow[] | null
  timezone: string
  onNavigate: () => void
}) {
  const now = useSyncExternalStore<number | null>(subscribeMinute, minuteNow, () => null)

  return (
    <>
      <div className="max-h-[min(60vh,26rem)] overflow-y-auto">
        {orders === null ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <InboxIcon className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">Nothing yet</p>
            <p className="text-xs text-muted-foreground">
              New orders land here the moment they&rsquo;re placed.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/pos/${o.id}`}
                  onClick={onNavigate}
                  className={cn(
                    "flex min-h-11 items-start gap-3 px-4 py-3 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none motion-reduce:transition-none",
                    o.status === "placed" && "bg-blue-500/5",
                  )}
                >
                  {/* Unread marker — the dot only reinforces the "Placed" badge
                      and the bold title, never carries the meaning alone. */}
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      o.status === "placed" ? "bg-blue-500" : "bg-transparent",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "truncate text-sm",
                          o.status === "placed" ? "font-semibold" : "font-medium",
                        )}
                      >
                        {o.restaurant_tables?.label
                          ? `Table ${o.restaurant_tables.label}`
                          : orderTypeLabel(o.order_type)}
                      </span>
                      <Badge
                        className={cn(
                          "border-transparent",
                          ORDER_STATUS_STYLE[o.status] ?? "bg-muted text-foreground",
                        )}
                      >
                        {orderStatusLabel(o.status)}
                      </Badge>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{orderTypeLabel(o.order_type)}</span>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">
                        {relativeTime(o.created_at, now, timezone)}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t p-2">
        <Button
          variant="ghost"
          className="w-full"
          nativeButton={false}
          render={<Link href="/notifications" onClick={onNavigate} />}
        >
          View all notifications
        </Button>
      </div>
    </>
  )
}
