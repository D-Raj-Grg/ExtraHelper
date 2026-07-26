"use client"

import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { MaximizeIcon, MinimizeIcon } from "lucide-react"
import { toast } from "sonner"

import { bumpKot, recallKot, setKotItemStatus } from "@/app/(app)/kds/actions"
import { voidLine } from "@/app/(app)/pos/actions"
import { createClient } from "@/lib/supabase/client"
import {
  kotStatusLabel,
  KDS_SELECT,
  KOT_FLOW,
  KOT_STATUS_META,
  type KotStatus,
} from "@/lib/kds-constants"
import { cn } from "@/lib/utils"
import { useHasPermission } from "@/components/permission-provider"
import { DishRail } from "@/components/kds/dish-rail"
import { StatusIcon } from "@/components/kds/status-icon"
import { TicketCard } from "@/components/kds/ticket-card"
import {
  isLive,
  UNVOIDABLE_ORDER_STATUSES,
  type KdsKot,
  type KdsStation,
} from "@/components/kds/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const ACTIVE = ["new", "preparing", "ready"]
// Bumped tickets stay recallable for a short window.
const RECALL_WINDOW_MS = 20 * 60 * 1000
const STORAGE_KEY = "kds:station"
/** Cancelled is not a kot_status — it's a voided line. Kept out of KOT_FLOW on purpose. */
const CANCELLED = "cancelled"

/** An optimistic patch: a whole ticket, or a single dish on it. */
type Patch =
  | { kind: "ticket"; id: string; status: string }
  | { kind: "line"; id: string; status: string }

/**
 * The kitchen board. The dish is the unit of work — each line carries its own
 * status (set_kot_item_status derives the ticket, then the order), with the
 * whole-ticket bump kept for the common case where a ticket lands together.
 */
export function KdsBoard({
  kots,
  stations,
  station,
  tenantId,
}: {
  kots: KdsKot[]
  stations: KdsStation[]
  station: string
  tenantId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [now, setNow] = useState(() => Date.now())
  const [statusFilter, setStatusFilter] = useState<string>("all")
  // Voids are manager-gated by void_order_item — a cook never sees the control.
  const canVoid = useHasPermission("order.void")
  // kds.view without kds.bump is a real combination (cashier): they watch the
  // board, they don't move dishes on it. Showing a button that always 42501s
  // would be worse than showing none.
  const canBump = useHasPermission("kds.bump")

  // Live board state, seeded from the server. Realtime + a safety poll keep it
  // fresh with a scoped refetch (joins mean a full row merge isn't enough).
  const [liveKots, setLiveKots] = useState<KdsKot[]>(kots)
  const [served, setServed] = useState<KdsKot[]>([])

  // Reseed from the server during render, not in an effect — an effect would
  // paint the stale board for a frame after a refresh.
  const [seed, setSeed] = useState<KdsKot[]>(kots)
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
    if (act.data) setLiveKots(act.data as unknown as KdsKot[])
    if (srv.data) setServed(srv.data as unknown as KdsKot[])
  }, [scoped])

  // Optimistic: the tap paints instantly, the refetch reconciles. A dish patch
  // also re-derives its ticket from the least-advanced live line, mirroring what
  // set_kot_item_status does server-side, so the header badge doesn't lag.
  const [optKots, applyPatch] = useOptimistic(liveKots, (state: KdsKot[], patch: Patch) => {
    if (patch.kind === "ticket")
      return state.map((k) =>
        k.id === patch.id
          ? {
              ...k,
              status: patch.status,
              kot_items: k.kot_items.map((l) => (isLive(l) ? { ...l, status: patch.status } : l)),
            }
          : k,
      )
    return state.map((k) => {
      if (!k.kot_items.some((l) => l.id === patch.id)) return k
      const kot_items = k.kot_items.map((l) =>
        l.id === patch.id ? { ...l, status: patch.status } : l,
      )
      const ranks = kot_items
        .filter(isLive)
        .map((l) => KOT_FLOW.indexOf(l.status as (typeof KOT_FLOW)[number]))
        .filter((i) => i >= 0)
      return { ...k, kot_items, status: ranks.length ? KOT_FLOW[Math.min(...ranks)] : k.status }
    })
  })

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

  // Counts are per *dish*, not per ticket — that's the unit a kitchen works in.
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    let total = 0
    for (const k of optKots)
      for (const line of k.kot_items) {
        const key = isLive(line) ? line.status : CANCELLED
        map.set(key, (map.get(key) ?? 0) + line.qty)
        total += line.qty
      }
    return { map, total }
  }, [optKots])

  // Filtering keeps whole tickets: a cook needs the rest of that table's order
  // for context, so a ticket shows when any of its dishes matches.
  const visible = useMemo(() => {
    if (statusFilter === "all") return optKots
    return optKots.filter((k) =>
      k.kot_items.some((l) =>
        statusFilter === CANCELLED ? !isLive(l) : isLive(l) && l.status === statusFilter,
      ),
    )
  }, [optKots, statusFilter])

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

  const stationFilters: { key: string; label: string }[] = [
    { key: "all", label: "All stations" },
    ...stations.map((s) => ({ key: s.id, label: s.name })),
    { key: "expo", label: "Expo" },
  ]

  const statusFilters = [
    { key: "all", label: "All", count: counts.total },
    ...KOT_FLOW.filter((s) => s !== "served").map((s) => ({
      key: s as string,
      label: KOT_STATUS_META[s].label,
      count: counts.map.get(s) ?? 0,
    })),
    { key: CANCELLED, label: "Cancelled", count: counts.map.get(CANCELLED) ?? 0 },
  ]

  /** Run a server action, surface its error, reconcile the board. */
  function run(
    fn: () => Promise<{ error: string } | { ok: true } | undefined>,
    patch?: Patch,
  ) {
    startTransition(async () => {
      if (patch) applyPatch(patch)
      const res = await fn()
      if (res && "error" in res) {
        toast.error(res.error)
        void refetch()
      }
    })
  }

  /** Void every still-live line on a ticket — the audited path, one call each. */
  function cancelTicket(kot: KdsKot, reason: string) {
    const orderId = kot.order_id
    if (!orderId) return
    const targets = kot.kot_items
      .filter(isLive)
      .map((l) => l.order_items?.id)
      .filter((id): id is string => Boolean(id))
    startTransition(async () => {
      for (const id of targets) {
        const res = await voidLine(orderId, id, reason)
        if (res && "error" in res) {
          toast.error(res.error)
          void refetch()
          return
        }
      }
      toast.success("Ticket cancelled.")
      void refetch()
    })
  }

  function ticketActions(kot: KdsKot, muted: boolean) {
    return {
      onLineStatus: (lineId: string, status: KotStatus) =>
        run(() => setKotItemStatus(lineId, status), { kind: "line", id: lineId, status }),
      onCancelLine: (orderItemId: string, reason: string) =>
        run(async () => {
          if (!kot.order_id) return undefined
          const res = await voidLine(kot.order_id, orderItemId, reason)
          if (!res || !("error" in res)) void refetch()
          return res
        }),
      onBump: (next: KotStatus) =>
        run(() => bumpKot(kot.id, next), { kind: "ticket", id: kot.id, status: next }),
      onCancelTicket: (reason: string) => cancelTicket(kot, reason),
      onRecall: muted
        ? () =>
            run(async () => {
              const res = await recallKot(kot.id)
              if (!res || !("error" in res)) void refetch()
              return res
            })
        : undefined,
    }
  }

  return (
    <div
      ref={boardRef}
      className="flex flex-col gap-3 bg-background data-[full=true]:h-screen data-[full=true]:overflow-auto data-[full=true]:p-4"
      data-full={isFull}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Station" className="flex flex-wrap gap-1.5">
          {stationFilters.map((f) => (
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

      <nav aria-label="Dish status" className="flex flex-wrap gap-1.5">
        {statusFilters.map((f) => {
          const active = statusFilter === f.key
          return (
            <Button
              key={f.key}
              type="button"
              variant={active ? "default" : "outline"}
              aria-pressed={active}
              onClick={() => setStatusFilter(f.key)}
              className="min-h-11 rounded-full"
            >
              {f.key === "all" ? null : <StatusIcon status={f.key} />}
              {f.label}
              <Badge
                className={cn(
                  "border-transparent tabular-nums",
                  active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted",
                )}
              >
                {f.count}
              </Badge>
            </Button>
          )
        })}
      </nav>

      <div className="grid gap-3 xl:grid-cols-[1fr_20rem] xl:items-start">
        <div className="flex flex-col gap-3">
          {optKots.length === 0 ? (
            <div className="rounded-xl border border-dashed p-12 text-center">
              <p className="text-lg font-semibold">All caught up</p>
              <p className="mt-1 text-sm text-muted-foreground">
                New tickets land here the moment they&apos;re fired.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed p-12 text-center">
              <p className="text-lg font-semibold">
                Nothing is{" "}
                {statusFilter === CANCELLED
                  ? "cancelled"
                  : kotStatusLabel(statusFilter).toLowerCase()}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {counts.total} {counts.total === 1 ? "dish is" : "dishes are"} on the board — tap
                All to see them.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {visible.map((kot) => (
                <TicketCard
                  key={kot.id}
                  kot={kot}
                  now={now}
                  pending={pending}
                  canVoid={canVoid && !UNVOIDABLE_ORDER_STATUSES.includes(kot.orders?.status ?? "")}
                  canBump={canBump}
                  actions={ticketActions(kot, false)}
                />
              ))}
            </div>
          )}

          {served.length > 0 ? (
            <section className="mt-2 border-t pt-3">
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                Completed orders — recall one bumped early
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {served.map((kot) => (
                  <TicketCard
                    key={kot.id}
                    kot={kot}
                    now={now}
                    pending={pending}
                    canVoid={false}
                    canBump={canBump}
                    muted
                    actions={ticketActions(kot, true)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <DishRail kots={optKots} />
      </div>
    </div>
  )
}
