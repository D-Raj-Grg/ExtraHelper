"use client"

import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BellIcon, CheckCheckIcon, InboxIcon } from "lucide-react"
import { toast } from "sonner"
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js"

import { createClient } from "@/lib/supabase/client"
import { useRequiredTenant } from "@/components/tenant-provider"
import {
  PermissionProvider,
  useHasPermission,
  usePermissions,
} from "@/components/permission-provider"
import { NotificationRow } from "@/components/notification-row"
import { useIsMobile } from "@/hooks/use-mobile"
import { minuteNow, subscribeMinute } from "@/lib/clock"
import { money } from "@/lib/format"
import {
  BELL_LIMIT,
  NOTIFICATION_SELECT,
  UNREAD_FALLBACK_MS,
  isUnread,
  notificationHref,
  type AppNotification,
} from "@/lib/notification-constants"
import { announceNotificationsRead, onNotificationsRead } from "@/lib/notification-read-sync"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

/**
 * Header bell for the order lifecycle: new → preparing → ready → served →
 * billed → paid (and cancelled), read from `public.notifications`, which only
 * the order/bill triggers write.
 *
 * Gated on the `notifications.view` permission key — the same key RLS checks —
 * rather than a role list, so a custom role gets the bell exactly when it can
 * read the rows. The header sits outside the sidebar's `PermissionProvider`,
 * so the layout hands us the (cached, shared) permissions promise and we mount
 * our own provider once it resolves; nothing waits on it but the bell.
 *
 * Read state is a per-user cursor (`notification_reads.last_read_at`). Unread =
 * newer than the cursor and not caused by you. Nothing is marked read by merely
 * opening the panel — "Mark all read", or tapping a row, does it explicitly.
 *
 * Quick view, not navigation: glancing at the bell mid-service shouldn't cost
 * you the screen you're on. Desktop gets a popover, phones a bottom sheet.
 */
export function NotificationBell({
  permissions,
  userId,
}: {
  permissions: Promise<string[]>
  userId: string
}) {
  return (
    <Suspense fallback={null}>
      <BellPermissionGate permissions={permissions} userId={userId} />
    </Suspense>
  )
}

function BellPermissionGate({
  permissions,
  userId,
}: {
  permissions: Promise<string[]>
  userId: string
}) {
  const keys = use(permissions)
  return (
    <PermissionProvider permissions={keys}>
      <BellIfAllowed userId={userId} />
    </PermissionProvider>
  )
}

function BellIfAllowed({ userId }: { userId: string }) {
  const allowed = useHasPermission("notifications.view")
  if (!allowed) return null
  return <Bell userId={userId} />
}

function Bell({ userId }: { userId: string }) {
  const { tenantId, timezone, currency } = useRequiredTenant()
  const perms = usePermissions()
  const router = useRouter()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[] | null>(null)
  const [count, setCount] = useState(0)
  // Rows newer than this are unread. Resolved in the fetch callback (it may be
  // "24h ago", which is impure to compute during render).
  const [cursor, setCursor] = useState<string | null>(null)
  // Ids already shown, so a realtime insert that a refetch (or a duplicate
  // delivery) beat us to never double-counts or double-toasts.
  const seen = useRef(new Set<string>())
  // False until the first fetch lands: that one is history, not news, so it
  // must not toast. Every later refetch toasts rows it is first to see — a row
  // the 45s poll or a rejoin catch-up found before realtime delivered it (or
  // one realtime dropped in a reconnect gap) still gets its toast.
  const primed = useRef(false)
  // The cursor as the realtime handler sees it — state would be a stale closure.
  const cursorRef = useRef<string | null>(null)
  // Latest-wins for refetches: an older response (a 45s poll that started before
  // "Mark all read", or the previous tenant's) must not overwrite newer state.
  const reqId = useRef(0)

  // Resolves to the rows this fetch was first to see that deserve a toast
  // (see `primed`); the effect below raises them.
  const refetch = useCallback(async (): Promise<AppNotification[]> => {
    const id = ++reqId.current
    const supabase = createClient()
    const [{ data: read }, { data: rows }] = await Promise.all([
      supabase
        .from("notification_reads")
        .select("last_read_at")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      supabase
        .from("notifications")
        .select(NOTIFICATION_SELECT)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(BELL_LIMIT),
    ])
    // Never look back further than the fallback window: a cursor weeks old would
    // make every open client count weeks of rows, every 45s.
    const floor = new Date(Date.now() - UNREAD_FALLBACK_MS).toISOString()
    const last = read?.last_read_at ?? null
    const since = last && Date.parse(last) > Date.parse(floor) ? last : floor
    // Counted server-side so the badge is right past the 20 rows we show.
    const { count: c } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gt("created_at", since)
      .or(`actor_id.is.null,actor_id.neq.${userId}`)
    if (id !== reqId.current) return []
    const list = (rows ?? []) as AppNotification[]
    const fresh = list.filter((r) => !seen.current.has(r.id))
    for (const r of list) seen.current.add(r.id)
    // Oldest first, so stacked toasts read in the order things happened.
    const toToast = primed.current
      ? [...fresh].reverse().filter((r) => isUnread(r, since, userId))
      : []
    primed.current = true
    cursorRef.current = since
    setCursor(since)
    setItems(list)
    setCount(c ?? 0)
    return toToast
  }, [tenantId, userId])

  // An Effect Event, so the subscription below doesn't depend on `perms`,
  // `currency` or `router`. `perms` is a fresh Set after every router.refresh()
  // (the layout re-issues the permissions promise), and as a dependency it tore
  // the channel down and rejoined after every POS order — dropping any insert
  // that landed in the gap, toast and all.
  const announce = useEffectEvent((n: AppNotification) => {
    const href = notificationHref(n, perms)
    toast(`${n.title} — ${n.body}`, {
      description: n.amount_cents !== null ? money(n.amount_cents, currency) : undefined,
      action: href ? { label: "View", onClick: () => router.push(href) } : undefined,
    })
  })

  const onInsert = useEffectEvent((n: AppNotification) => {
    if (!n?.id || seen.current.has(n.id)) return
    seen.current.add(n.id)
    setItems((prev) => [n, ...(prev ?? []).filter((p) => p.id !== n.id)].slice(0, BELL_LIMIT))
    // Your own tap is in the feed, but never a badge or a toast.
    if (n.actor_id === userId) return
    // Same rule the rows render with, so badge and bold can't disagree — e.g. a
    // row committed just before a "Mark all read" landed but delivered after.
    if (isUnread(n, cursorRef.current, userId)) setCount((c) => c + 1)
    announce(n)
  })

  useEffect(() => {
    const supabase = createClient()
    const requests = reqId
    let timer: ReturnType<typeof setTimeout> | null = null
    const sync = async () => {
      for (const n of await refetch()) announce(n)
    }
    const ping = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void sync(), 200)
    }
    // First load rides along with the subscription, debounced like every other
    // refetch so state only ever lands from a callback, never synchronously in
    // the effect body.
    ping()
    const channel = supabase
      .channel(`notif-bell:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload: RealtimePostgresInsertPayload<AppNotification>) => onInsert(payload.new),
      )
      // Re-sync on every (re)subscribe: a dropped socket misses inserts.
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") ping()
      })
    const safety = setInterval(() => void sync(), 45000)
    // Marked read on the /notifications page: re-read the cursor and count.
    const stopReadSync = onNotificationsRead(tenantId, ping)
    return () => {
      if (timer) clearTimeout(timer)
      clearInterval(safety)
      stopReadSync()
      // Orphan any refetch still in flight for this tenant.
      requests.current++
      void supabase.removeChannel(channel)
    }
  }, [tenantId, refetch])

  const markAllRead = useCallback(async () => {
    // Optimistic: the badge clears the moment you ask. Bumping reqId drops any
    // refetch already in flight, which read the old cursor.
    reqId.current++
    const optimistic = new Date().toISOString()
    cursorRef.current = optimistic
    setCount(0)
    setCursor(optimistic)
    const supabase = createClient()
    const { error } = await supabase.rpc("mark_notifications_read", { _tenant: tenantId })
    if (error) toast.error("Couldn't mark notifications as read. Try again.")
    else announceNotificationsRead(tenantId)
    // Either way, the server's answer is the truth — count included. Rows it is
    // first to see are not toasted: you have just read the list.
    await refetch()
  }, [tenantId, refetch])

  const label = count > 0 ? `Notifications (${count > 99 ? "99+" : count} unread)` : "Notifications"
  const trigger = (
    <Button variant="ghost" size="icon-sm" className="relative max-md:size-11" aria-label={label} title="Notifications">
      <BellIcon />
      {count > 0 ? (
        <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Button>
  )

  const markButton = (
    <Button
      variant="ghost"
      size="sm"
      className="max-md:min-h-11"
      disabled={count === 0}
      onClick={() => void markAllRead()}
    >
      <CheckCheckIcon />
      Mark all read
    </Button>
  )

  const panel = (
    <NotificationPanel
      items={items}
      cursor={cursor}
      userId={userId}
      timezone={timezone}
      currency={currency}
      perms={perms}
      onSelect={() => {
        if (count > 0) void markAllRead()
      }}
      onNavigate={() => setOpen(false)}
    />
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={trigger} />
        <SheetContent side="bottom" className="max-h-[80vh] gap-0 p-0">
          <SheetHeader className="flex-row items-center justify-between gap-2 border-b pr-12">
            <SheetTitle>Notifications</SheetTitle>
            {markButton}
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="end" className="w-96 overflow-hidden p-0">
        <div className="flex items-center justify-between gap-2 border-b py-1.5 pr-2 pl-4">
          <p className="font-heading text-sm font-medium">Notifications</p>
          {markButton}
        </div>
        {panel}
      </PopoverContent>
    </Popover>
  )
}

function NotificationPanel({
  items,
  cursor,
  userId,
  timezone,
  currency,
  perms,
  onSelect,
  onNavigate,
}: {
  items: AppNotification[] | null
  cursor: string | null
  userId: string
  timezone: string
  currency: string
  perms: Set<string>
  onSelect: () => void
  onNavigate: () => void
}) {
  const now = useSyncExternalStore<number | null>(subscribeMinute, minuteNow, () => null)

  return (
    <>
      <div className="max-h-[min(60vh,28rem)] overflow-y-auto">
        {items === null ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <InboxIcon className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">Nothing yet</p>
            <p className="text-xs text-muted-foreground">
              Every step of an order — placed, cooking, ready, served, paid — lands here as it
              happens.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((n) => {
              const href = notificationHref(n, perms)
              return (
                <li key={n.id}>
                  <NotificationRow
                    n={n}
                    now={now}
                    timezone={timezone}
                    currency={currency}
                    unread={isUnread(n, cursor, userId)}
                    href={href}
                    onSelect={() => {
                      onSelect()
                      if (href) onNavigate()
                    }}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="border-t p-2">
        <Button
          variant="ghost"
          className="w-full max-md:min-h-11"
          nativeButton={false}
          render={<Link href="/notifications" onClick={onNavigate} />}
        >
          View all notifications
        </Button>
      </div>
    </>
  )
}
