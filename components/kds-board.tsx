"use client"

import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { bumpKot, recallKot } from "@/app/(app)/kds/actions"
import { createClient } from "@/lib/supabase/client"
import { KOT_FLOW, type KotStatus } from "@/lib/kds-constants"
import { Button } from "@/components/ui/button"

const KDS_SELECT =
  "id, status, created_at, station_id, kitchen_stations(name), orders(table_id, restaurant_tables!orders_table_id_fkey(label)), kot_items(id, qty, status, order_items(name_snapshot))"
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
  kot_items: { id: string; qty: number; status: string; order_items: { name_snapshot: string } | null }[]
}

/** Next status in the bump flow, or null if terminal. */
function nextStatus(status: string): KotStatus | null {
  const i = KOT_FLOW.indexOf(status as (typeof KOT_FLOW)[number])
  if (i < 0 || i >= KOT_FLOW.length - 1) return null
  return KOT_FLOW[i + 1]
}

/** Aging border: green < 5m, amber < 10m, red beyond. */
function ageStyle(createdAt: string, now: number): string {
  const mins = (now - new Date(createdAt).getTime()) / 60000
  if (mins < 5) return "border-green-500/60"
  if (mins < 10) return "border-amber-500/70"
  return "border-red-500/80"
}

function ageLabel(createdAt: string, now: number): string {
  const mins = Math.floor((now - new Date(createdAt).getTime()) / 60000)
  return mins <= 0 ? "just now" : `${mins}m`
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
  useEffect(() => setLiveKots(kots), [kots])

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
  useEffect(() => {
    void refetch()
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const safety = setInterval(() => void refetch(), 45000)
    return () => {
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
        <div className="flex flex-wrap gap-1">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => selectStation(f.key)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                station === f.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={toggleFullscreen}>
          {isFull ? "Exit fullscreen" : "Fullscreen"}
        </Button>
      </div>

      {allDay.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 rounded-lg border bg-card/50 p-2 text-xs">
          <span className="font-semibold text-muted-foreground">All day:</span>
          {allDay.map(([name, qty]) => (
            <span key={name} className="rounded bg-muted px-1.5 py-0.5">
              {name} <span className="font-semibold">×{qty}</span>
            </span>
          ))}
        </div>
      ) : null}

      {optKots.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active tickets. All caught up.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {optKots.map((kot) => {
            const next = nextStatus(kot.status)
            return (
              <div
                key={kot.id}
                className={`flex flex-col rounded-lg border-2 bg-card p-3 ${ageStyle(
                  kot.created_at,
                  now,
                )}`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold">{kot.kitchen_stations?.name ?? "Expo"}</span>
                  <span className="text-xs text-muted-foreground">
                    {kot.orders?.restaurant_tables?.label ?? "—"} · {ageLabel(kot.created_at, now)}
                  </span>
                </div>
                <ul className="mb-3 flex-1 space-y-1 text-sm">
                  {kot.kot_items.map((ki) => (
                    <li key={ki.id} className="flex justify-between">
                      <span>{ki.order_items?.name_snapshot ?? "item"}</span>
                      <span className="text-muted-foreground">×{ki.qty}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium capitalize">
                    {kot.status}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Print ticket"
                      onClick={() => window.open(`/kot/${kot.id}`, "_blank", "noopener")}
                      className="rounded border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Print
                    </button>
                  {next ? (
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          applyBump({ id: kot.id, status: next })
                          const res = await bumpKot(kot.id, next)
                          if (res && "error" in res) toast.error(res.error)
                        })
                      }
                    >
                      {next === "preparing" ? "Start" : next === "ready" ? "Ready" : "Bump"}
                    </Button>
                  ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {served.length > 0 ? (
        <div className="mt-2 border-t pt-2">
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
            Recently served — recall if bumped early
          </p>
          <div className="flex flex-wrap gap-1.5">
            {served.map((k) => (
              <button
                key={k.id}
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await recallKot(k.id)
                    if (res && "error" in res) toast.error(res.error)
                    else void refetch()
                  })
                }
                className="rounded border bg-card px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
              >
                ↩ {k.kitchen_stations?.name ?? "Expo"} ·{" "}
                {k.orders?.restaurant_tables?.label ?? "—"}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
