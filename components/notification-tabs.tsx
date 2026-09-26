"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { CheckCheckIcon, InboxIcon } from "lucide-react"
import { toast } from "sonner"
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { formatDateTime } from "@/lib/format"
import { minuteNow, subscribeMinute } from "@/lib/clock"
import { ACTION_STYLES } from "@/lib/audit-constants"
import {
  FEED_LIMIT,
  NOTIFICATION_SELECT,
  UNREAD_FALLBACK_MS,
  isUnread,
  notificationHref,
  type AppNotification,
} from "@/lib/notification-constants"
import { announceNotificationsRead, onNotificationsRead } from "@/lib/notification-read-sync"
import { usePermissions } from "@/components/permission-provider"
import { NotificationRow } from "@/components/notification-row"
import { Button } from "@/components/ui/button"

type ActivityRow = {
  id: string
  action: string
  entity_type: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export function NotificationTabs({
  updates,
  activity,
  tenantId,
  timezone,
  currency,
  canSeeActivity,
  userId,
}: {
  updates: AppNotification[]
  activity: ActivityRow[] | null
  tenantId: string
  timezone: string
  currency: string
  canSeeActivity: boolean
  userId: string
}) {
  const [tab, setTab] = useState<"updates" | "activity">("updates")

  // Updates feed kept live via Realtime: inserts land directly, a 45s refetch
  // catches anything a dropped socket missed. A fresh server render
  // (router.refresh, navigation) has to win over what Realtime last wrote, so
  // the live copy resets when the prop identity changes — adjusted during
  // render rather than in an effect, which would paint the stale rows first.
  const [liveUpdates, setLiveUpdates] = useState<AppNotification[]>(updates)
  const [seededUpdates, setSeededUpdates] = useState(updates)
  if (updates !== seededUpdates) {
    setSeededUpdates(updates)
    setLiveUpdates(updates)
  }

  // The user's read cursor, same rule as the bell (never older than the 24h
  // window). Null until the first client fetch: the server render shows no
  // unread styling rather than compute "24h ago" during render.
  const [cursor, setCursor] = useState<string | null>(null)
  const reqId = useRef(0)

  const refetch = useCallback(async () => {
    const id = ++reqId.current
    const supabase = createClient()
    const [{ data }, { data: read }] = await Promise.all([
      supabase
        .from("notifications")
        .select(NOTIFICATION_SELECT)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(FEED_LIMIT),
      supabase
        .from("notification_reads")
        .select("last_read_at")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ])
    // Latest wins: a poll that read the old cursor must not undo "Mark all read".
    if (id !== reqId.current) return
    if (data) setLiveUpdates(data as AppNotification[])
    const floor = new Date(Date.now() - UNREAD_FALLBACK_MS).toISOString()
    const last = read?.last_read_at ?? null
    setCursor(last && Date.parse(last) > Date.parse(floor) ? last : floor)
  }, [tenantId, userId])

  const markAllRead = useCallback(async () => {
    reqId.current++
    setCursor(new Date().toISOString())
    const supabase = createClient()
    const { error } = await supabase.rpc("mark_notifications_read", { _tenant: tenantId })
    if (error) toast.error("Couldn't mark notifications as read. Try again.")
    else announceNotificationsRead(tenantId)
    await refetch()
  }, [tenantId, refetch])

  const unreadCount =
    cursor === null ? 0 : liveUpdates.filter((n) => isUnread(n, cursor, userId)).length

  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const ping = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refetch(), 200)
    }
    const channel = supabase
      .channel(`notif-feed:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload: RealtimePostgresInsertPayload<AppNotification>) => {
          const n = payload.new
          if (!n?.id) return
          setLiveUpdates((prev) =>
            prev.some((p) => p.id === n.id) ? prev : [n, ...prev].slice(0, FEED_LIMIT),
          )
        },
      )
      // Catch up on every subscribe, the first included: inserts between the
      // server render and the socket joining (seconds on a slow phone) would
      // otherwise wait for the 45s poll.
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") ping()
      })
    const safety = setInterval(() => void refetch(), 45000)
    // Marked read from the header bell: re-read the cursor.
    const stopReadSync = onNotificationsRead(tenantId, ping)
    const requests = reqId
    return () => {
      if (timer) clearTimeout(timer)
      clearInterval(safety)
      stopReadSync()
      requests.current++
      void supabase.removeChannel(channel)
    }
  }, [tenantId, refetch])

  // Activity tab — also live (audit_logs realtime; RLS delivers only to
  // owner/manager, so only subscribe when the tab is available).
  const [liveActivity, setLiveActivity] = useState<ActivityRow[]>(activity ?? [])
  // Compared on `activity` itself, not on `activity ?? []` — the coalesced
  // array is a new reference every render and would reset the list forever.
  const [seededActivity, setSeededActivity] = useState(activity)
  if (activity !== seededActivity) {
    setSeededActivity(activity)
    setLiveActivity(activity ?? [])
  }

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
        <Button
          type="button"
          variant={tab === "updates" ? "secondary" : "ghost"}
          size="sm"
          className="max-md:min-h-11"
          aria-pressed={tab === "updates"}
          onClick={() => setTab("updates")}
        >
          Updates
        </Button>
        {canSeeActivity ? (
          <Button
            type="button"
            variant={tab === "activity" ? "secondary" : "ghost"}
            size="sm"
            className="max-md:min-h-11"
            aria-pressed={tab === "activity"}
            onClick={() => setTab("activity")}
          >
            Activity
          </Button>
        ) : null}
      </div>

      {tab === "updates" ? (
        <>
          {liveUpdates.length > 0 ? (
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="max-md:min-h-11"
                disabled={unreadCount === 0}
                onClick={() => void markAllRead()}
              >
                <CheckCheckIcon />
                Mark all read
              </Button>
            </div>
          ) : null}
          <UpdatesList
            updates={liveUpdates}
            cursor={cursor}
            userId={userId}
            timezone={timezone}
            currency={currency}
            onSelect={() => {
              if (unreadCount > 0) void markAllRead()
            }}
          />
        </>
      ) : (
        <ActivityList activity={liveActivity} timezone={timezone} />
      )}
    </div>
  )
}

function UpdatesList({
  updates,
  cursor,
  userId,
  timezone,
  currency,
  onSelect,
}: {
  updates: AppNotification[]
  cursor: string | null
  userId: string
  timezone: string
  currency: string
  onSelect: () => void
}) {
  const perms = usePermissions()
  const now = useSyncExternalStore<number | null>(subscribeMinute, minuteNow, () => null)

  if (updates.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border px-4 py-10 text-center">
        <InboxIcon className="size-5 text-muted-foreground" />
        <p className="text-sm font-medium">No updates yet</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Place an order from the POS and every step it takes — kitchen, ready, served, billed,
          paid — shows up here live.
        </p>
      </div>
    )

  return (
    <ul className="flex flex-col divide-y overflow-hidden rounded-lg border">
      {updates.map((n) => (
        <li key={n.id}>
          <NotificationRow
            n={n}
            now={now}
            timezone={timezone}
            currency={currency}
            href={notificationHref(n, perms)}
            unread={isUnread(n, cursor, userId)}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
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
