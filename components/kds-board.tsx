"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { bumpKot } from "@/app/(app)/kds/actions"
import { createClient } from "@/lib/supabase/client"
import { KOT_FLOW, type KotStatus } from "@/lib/kds-constants"
import { Button } from "@/components/ui/button"

type Kot = {
  id: string
  status: string
  created_at: string
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

export function KdsBoard({ kots, tenantId }: { kots: Kot[]; tenantId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [now, setNow] = useState(() => Date.now())

  // Aging tick (1s) + a long safety poll in case the realtime socket drops.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const safety = setInterval(() => router.refresh(), 30000)
    return () => {
      clearInterval(tick)
      clearInterval(safety)
    }
  }, [router])

  // Live updates: refresh the board on any KOT / KOT-item / order change for
  // this tenant (new fires, bumps, cancels) via Supabase Realtime.
  useEffect(() => {
    const supabase = createClient()
    const filter = `tenant_id=eq.${tenantId}`
    const channel = supabase
      .channel(`kds:${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "kots", filter }, () =>
        router.refresh(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "kot_items", filter }, () =>
        router.refresh(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter }, () =>
        router.refresh(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [router, tenantId])

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

  return (
    <div
      ref={boardRef}
      className="flex flex-col gap-3 bg-background data-[full=true]:h-screen data-[full=true]:overflow-auto data-[full=true]:p-4"
      data-full={isFull}
    >
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={toggleFullscreen}>
          {isFull ? "Exit fullscreen" : "Fullscreen"}
        </Button>
      </div>
      {kots.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active tickets. All caught up.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {kots.map((kot) => {
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
              <span className="font-semibold">
                {kot.kitchen_stations?.name ?? "Expo"}
              </span>
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
            <div className="flex items-center justify-between">
              <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium capitalize">
                {kot.status}
              </span>
              {next ? (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await bumpKot(kot.id, next)
                    })
                  }
                >
                  {next === "preparing" ? "Start" : next === "ready" ? "Ready" : "Bump"}
                </Button>
              ) : null}
            </div>
          </div>
        )
          })}
        </div>
      )}
    </div>
  )
}
