"use client"

import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangleIcon,
  ClockIcon,
  MaximizeIcon,
  MinimizeIcon,
  PrinterIcon,
  Undo2Icon,
} from "lucide-react"
import { toast } from "sonner"
import { bumpKot, recallKot } from "@/app/(app)/kds/actions"
import { createClient } from "@/lib/supabase/client"
import {
  kotStatusLabel,
  ticketAge,
  KOT_FLOW,
  KOT_STATUS_STYLE,
  type KotStatus,
} from "@/lib/kds-constants"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const KDS_SELECT =
  "id, status, created_at, station_id, kitchen_stations(name), orders(table_id, restaurant_tables!orders_table_id_fkey(label)), kot_items(id, qty, status, order_items(name_snapshot, is_void, void_reason))"
const ACTIVE = ["new", "preparing", "ready"]
// Bumped tickets stay recallable for a short window.
const RECALL_WINDOW_MS = 20 * 60 * 1000
const STORAGE_KEY = "kds:station"

type Station = { id: string; name: string }
type Kot = {
  id: string
  status: string
  created_at: string
  station_id: string | null
  kitchen_stations: { name: string } | null
  orders: { restaurant_tables: { label: string } | null } | null
  kot_items: {
    id: string
    qty: number
    status: string
    order_items: { name_snapshot: string; is_void: boolean; void_reason: string | null } | null
  }[]
}

/** Next status in the bump flow, or null if terminal. */
function nextStatus(status: string): KotStatus | null {
  const i = KOT_FLOW.indexOf(status as (typeof KOT_FLOW)[number])
  if (i < 0 || i >= KOT_FLOW.length - 1) return null
  return KOT_FLOW[i + 1]
}

/**
 * One kitchen ticket. Read across a hot room at a glance, so the table is the
 * loudest thing on it, quantities lead each line, and the bump button is the
 * full width of the card — cooks hit it with the side of a hand.
 */
function TicketCard({
  kot,
  now,
  pending,
  onBump,
}: {
  kot: Kot
  now: number
  pending: boolean
  onBump: (next: KotStatus) => void
}) {
  const next = nextStatus(kot.status)
  const age = ticketAge(kot.created_at, now)
  const table = kot.orders?.restaurant_tables?.label
  const bumpLabel = next === "preparing" ? "Start" : next === "ready" ? "Ready" : "Bump"

  return (
    <div className={cn("flex flex-col rounded-xl border-2 bg-card p-3", age.border)}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xl font-bold leading-tight">
            {table ? `Table ${table}` : "Takeaway"}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {kot.kitchen_stations?.name ?? "Expo"}
          </p>
        </div>
        {/* Age carries an icon + minutes, not just a border colour. */}
        <span className={cn("flex shrink-0 items-center gap-1 text-sm font-semibold", age.text)}>
          {age.late ? (
            <AlertTriangleIcon className="size-4" aria-hidden />
          ) : (
            <ClockIcon className="size-4" aria-hidden />
          )}
          <span className="tabular-nums">{age.label}</span>
        </span>
      </div>

      <ul className="mb-3 flex flex-1 flex-col gap-1.5">
        {kot.kot_items.map((ki) => {
          const voided = ki.order_items?.is_void
          return (
            <li key={ki.id} className="flex items-baseline gap-2">
              <span
                className={cn(
                  "shrink-0 text-base font-bold tabular-nums",
                  voided ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {ki.qty}×
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "text-base leading-snug",
                    voided && "text-muted-foreground line-through decoration-destructive",
                  )}
                >
                  {ki.order_items?.name_snapshot ?? "item"}
                </span>
                {voided ? (
                  <span className="mt-0.5 block">
                    <Badge className="border-transparent bg-destructive/10 text-destructive no-underline">
                      Void
                      {ki.order_items?.void_reason ? ` · ${ki.order_items.void_reason}` : ""}
                    </Badge>
                  </span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="flex items-center gap-2">
        <Badge className={cn("border-transparent", KOT_STATUS_STYLE[kot.status] ?? "bg-muted")}>
          {kotStatusLabel(kot.status)}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto size-11"
          aria-label={`Print ticket for ${table ? `table ${table}` : "takeaway"}`}
          onClick={() => window.open(`/kot/${kot.id}`, "_blank", "noopener")}
        >
          <PrinterIcon className="size-4" />
        </Button>
        {next ? (
          <Button
            className="h-12 flex-1 text-base"
            disabled={pending}
            onClick={() => onBump(next)}
          >
            {bumpLabel}
            <span className="sr-only"> {table ? `table ${table}` : "takeaway"} ticket</span>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function KdsBoard({
  kots,
  stations,
  station,
  tenantId,
}: {
  kots: Kot[]
  stations: Station[]
  station: string
  tenantId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [now, setNow] = useState(() => Date.now())

  // Live board state, seeded from the server. Realtime + a safety poll keep it
  // fresh with a scoped refetch (joins mean a full row merge isn't enough).
  const [liveKots, setLiveKots] = useState<Kot[]>(kots)
  const [served, setServed] = useState<Kot[]>([])

  // Reseed from the server during render, not in an effect — an effect would
  // paint the stale board for a frame after a refresh.
  const [seed, setSeed] = useState<Kot[]>(kots)
  if (seed !== kots) {
    setSeed(kots)
    setLiveKots(kots)
  }

  // Restore this screen's saved station after a reboot (URL default = "all").
  useEffect(() => {
    if (station !== "all") return
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null
    if (saved && saved !== "all") router.replace(`/kds?station=${saved}`)
  }, [station, router])

  function selectStation(next: string) {
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, next)
    router.push(next === "all" ? "/kds" : `/kds?station=${next}`)
  }

  // Apply the active station filter to a kots query (shared by both fetches).
  const scoped = useCallback(
    (q: ReturnType<ReturnType<typeof createClient>["from"]>) => {
      const base = q.select(KDS_SELECT).eq("tenant_id", tenantId)
      if (station === "expo") return base.is("station_id", null)
      if (station !== "all") return base.eq("station_id", station)
      return base
    },
    [tenantId, station],
  )

  const refetch = useCallback(async () => {
    const supabase = createClient()
    const [act, srv] = await Promise.all([
      scoped(supabase.from("kots")).in("status", ACTIVE).order("created_at", { ascending: true }),
      scoped(supabase.from("kots"))
        .eq("status", "served")
        .gte("created_at", new Date(Date.now() - RECALL_WINDOW_MS).toISOString())
        .order("created_at", { ascending: false }),
    ])
    if (act.data) setLiveKots(act.data as unknown as Kot[])
    if (srv.data) setServed(srv.data as unknown as Kot[])
  }, [scoped])

  // Optimistic bump — ticket advances instantly; the refetch reconciles.
  const [optKots, applyBump] = useOptimistic(
    liveKots,
    (state: Kot[], patch: { id: string; status: string }) =>
      state.map((k) => (k.id === patch.id ? { ...k, status: patch.status } : k)),
  )

  // Aging tick (1s) + a long safety refetch in case the realtime socket drops.
  // The first fetch is scheduled rather than run in the effect body: the board
  // is already seeded from the server, so it doesn't need to block paint (and
  // it pulls the recall list, which isn't in the props).
  useEffect(() => {
    const initial = setTimeout(() => void refetch(), 0)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const safety = setInterval(() => void refetch(), 45000)
    return () => {
      clearTimeout(initial)
      clearInterval(tick)
      clearInterval(safety)
    }
  }, [refetch])

  // Live: debounced scoped refetch on any KOT / KOT-item / order change.
  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const ping = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refetch(), 150)
    }
    const filter = `tenant_id=eq.${tenantId}`
    const channel = supabase
      .channel(`kds:${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "kots", filter }, ping)
      .on("postgres_changes", { event: "*", schema: "public", table: "kot_items", filter }, ping)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter }, ping)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter }, ping)
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [tenantId, refetch])

  // All-day counts: total qty per item across the visible active tickets.
  const allDay = useMemo(() => {
    const counts = new Map<string, number>()
    for (const k of optKots)
      for (const ki of k.kot_items) {
        if (ki.order_items?.is_void) continue
        const name = ki.order_items?.name_snapshot ?? "item"
        counts.set(name, (counts.get(name) ?? 0) + ki.qty)
      }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [optKots])

  const boardRef = useRef<HTMLDivElement>(null)
  const [isFull, setIsFull] = useState(false)

  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement))
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void boardRef.current?.requestFullscreen()
  }

  const filters: { key: string; label: string }[] = [
    { key: "all", label: "All stations" },
    ...stations.map((s) => ({ key: s.id, label: s.name })),
    { key: "expo", label: "Expo" },
  ]

  return (
    <div
      ref={boardRef}
      className="flex flex-col gap-3 bg-background data-[full=true]:h-screen data-[full=true]:overflow-auto data-[full=true]:p-4"
      data-full={isFull}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Station" className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <Button
              key={f.key}
              type="button"
              variant={station === f.key ? "default" : "outline"}
              aria-pressed={station === f.key}
              onClick={() => selectStation(f.key)}
              className="min-h-11 rounded-full"
            >
              {f.label}
            </Button>
          ))}
        </nav>
        <Button variant="outline" className="min-h-11" onClick={toggleFullscreen}>
          {isFull ? <MinimizeIcon className="size-4" /> : <MaximizeIcon className="size-4" />}
          {isFull ? "Exit fullscreen" : "Fullscreen"}
        </Button>
      </div>

      {allDay.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/50 p-2.5">
          <span className="text-sm font-semibold text-muted-foreground">All day</span>
          {allDay.map(([name, qty]) => (
            <span key={name} className="rounded-md bg-muted px-2 py-1 text-sm">
              {name} <span className="font-bold tabular-nums">×{qty}</span>
            </span>
          ))}
        </div>
      ) : null}

      {optKots.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <p className="text-lg font-semibold">All caught up</p>
          <p className="mt-1 text-sm text-muted-foreground">
            New tickets land here the moment they&apos;re fired.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {optKots.map((kot) => (
            <TicketCard
              key={kot.id}
              kot={kot}
              now={now}
              pending={pending}
              onBump={(next) =>
                startTransition(async () => {
                  applyBump({ id: kot.id, status: next })
                  const res = await bumpKot(kot.id, next)
                  if (res && "error" in res) toast.error(res.error)
                })
              }
            />
          ))}
        </div>
      )}

      {served.length > 0 ? (
        <div className="mt-2 border-t pt-3">
          <p className="mb-2 text-sm font-semibold text-muted-foreground">
            Recently served — tap to recall one bumped early
          </p>
          <div className="flex flex-wrap gap-2">
            {served.map((k) => {
              const table = k.orders?.restaurant_tables?.label
              return (
                <Button
                  key={k.id}
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await recallKot(k.id)
                      if (res && "error" in res) toast.error(res.error)
                      else void refetch()
                    })
                  }
                >
                  <Undo2Icon className="size-4" />
                  {table ? `Table ${table}` : "Takeaway"}
                  <span className="text-muted-foreground">
                    {k.kitchen_stations?.name ?? "Expo"}
                  </span>
                  <span className="sr-only"> — recall this ticket</span>
                </Button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
