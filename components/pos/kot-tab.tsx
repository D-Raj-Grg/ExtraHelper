"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { ChefHatIcon } from "lucide-react"
import { toast } from "sonner"

import { bumpKot } from "@/app/(app)/kds/actions"
import { voidLine } from "@/app/(app)/pos/actions"
import { createClient } from "@/lib/supabase/client"
import { KOT_CARD_SELECT, KOT_TAB_STATUSES } from "@/lib/pos-constants"
import { KOT_FLOW } from "@/lib/kds-constants"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { KotCard, type KotTicket, type KotTicketLine } from "@/components/pos/kot-card"
import type { PosKot, PosStaff } from "@/components/pos/types"

const ACTIVE = ["new", "preparing", "ready"]
// Once an order is billed/closed/cancelled a line void can't recompute a paid
// bill — cancel is withdrawn rather than corrupting the total.
const UNCANCELLABLE = ["billed", "closed", "cancelled"]

/** Least-advanced status across a set — a combined ticket is "cooking" if any station still is. */
function slowestStatus(kots: PosKot[]): string {
  let best = KOT_FLOW.length - 1
  for (const k of kots) {
    const i = KOT_FLOW.indexOf(k.status as (typeof KOT_FLOW)[number])
    if (i >= 0 && i < best) best = i
  }
  return KOT_FLOW[best]
}

function toLines(kot: PosKot): KotTicketLine[] {
  return kot.kot_items.map((ki) => ({
    id: ki.id,
    orderItemId: ki.order_items?.id ?? null,
    name: ki.order_items?.name_snapshot ?? "item",
    qty: ki.qty,
    isVoid: ki.order_items?.is_void ?? false,
    notes: ki.order_items?.notes ?? null,
    mods: ki.order_items?.order_item_modifiers ?? [],
  }))
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase()
}

/**
 * The KOT pane: kitchen tickets as cashier-facing cards. Owns its own Realtime
 * channel (the board's usePosRealtime only tracks orders), plus the two view
 * toggles. Split-by-type ON renders one card per physical KOT — already one per
 * kitchen station from fire_order; OFF merges an order's stations into one card.
 */
export function KotTab({
  initialKots,
  staff,
  timeZone,
  tenantId,
}: {
  initialKots: PosKot[]
  staff: PosStaff[]
  timeZone: string
  tenantId: string
}) {
  const [pending, startTransition] = useTransition()
  const [showCompleted, setShowCompleted] = useState(false)
  const [splitByType, setSplitByType] = useState(true)
  const [kots, setKots] = useState<PosKot[]>(initialKots)

  // Reseed from the server during render, not an effect — an effect paints the
  // stale list for a frame after a revalidate.
  const [seed, setSeed] = useState<PosKot[]>(initialKots)
  if (seed !== initialKots) {
    setSeed(initialKots)
    setKots(initialKots)
  }

  const staffName = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of staff) m.set(s.user_id, s.name)
    return m
  }, [staff])

  const refetch = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from("kots")
      .select(KOT_CARD_SELECT)
      .eq("tenant_id", tenantId)
      .in("status", KOT_TAB_STATUSES)
      .order("created_at", { ascending: false })
    if (data) setKots(data as unknown as PosKot[])
  }, [tenantId])

  // Live: debounced refetch on any ticket / line / order change (joins mean a
  // row-level merge isn't enough — the same reason kds-board refetches).
  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const ping = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refetch(), 150)
    }
    const filter = `tenant_id=eq.${tenantId}`
    const channel = supabase
      .channel(`pos-kot:${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "kots", filter }, ping)
      .on("postgres_changes", { event: "*", schema: "public", table: "kot_items", filter }, ping)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter }, ping)
      .subscribe()
    // Pull fresh on mount — the tab unmounts when you leave it, so the seeded
    // prop can be stale by the time you come back (a bump on another terminal).
    const initial = setTimeout(() => void refetch(), 0)
    return () => {
      clearTimeout(initial)
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [tenantId, refetch])

  const visible = showCompleted ? kots : kots.filter((k) => ACTIVE.includes(k.status))

  const tickets: KotTicket[] = useMemo(() => {
    const meta = (k: PosKot) => ({
      tableLabel: k.orders?.restaurant_tables?.label ?? null,
      orderType: k.orders?.order_type ?? "dine_in",
      staffName: (k.orders?.waiter_id && staffName.get(k.orders.waiter_id)) || "Staff",
      canCancel: !UNCANCELLABLE.includes(k.orders?.status ?? ""),
    })

    if (splitByType) {
      return visible.map((k) => ({
        key: k.id,
        kotIds: [k.id],
        orderId: k.order_id,
        number: `KOT #${shortId(k.id)}`,
        station: k.kitchen_stations?.name ?? null,
        ...meta(k),
        createdAt: k.created_at,
        printed: Boolean(k.printed_at),
        status: k.status,
        lines: toLines(k),
      }))
    }

    // Combined: merge an order's station tickets into one card.
    const byOrder = new Map<string, PosKot[]>()
    for (const k of visible) {
      const key = k.order_id ?? k.id
      const list = byOrder.get(key)
      if (list) list.push(k)
      else byOrder.set(key, [k])
    }
    return [...byOrder.entries()].map(([orderKey, group]) => {
      const head = group[0]
      return {
        key: orderKey,
        kotIds: group.map((k) => k.id),
        orderId: head.order_id,
        number: `KOT #${shortId(orderKey)}`,
        station: null,
        ...meta(head),
        createdAt: group.reduce((a, k) => (k.created_at < a ? k.created_at : a), head.created_at),
        printed: group.every((k) => Boolean(k.printed_at)),
        status: slowestStatus(group),
        lines: group.flatMap(toLines),
      }
    })
  }, [visible, splitByType, staffName])

  function changeStatus(ticket: KotTicket, status: string) {
    // Optimistic: advance every underlying ticket locally; refetch reconciles.
    setKots((prev) =>
      prev.map((k) => (ticket.kotIds.includes(k.id) ? { ...k, status } : k)),
    )
    startTransition(async () => {
      for (const id of ticket.kotIds) {
        const res = await bumpKot(id, status as (typeof KOT_FLOW)[number])
        if (res && "error" in res) {
          toast.error(res.error)
          void refetch()
          return
        }
      }
    })
  }

  function printTicket(ticket: KotTicket) {
    // Opening the print view stamps printed_at (PrintOnLoad) — Realtime then
    // lights the printed badge. One tab per station ticket.
    for (const id of ticket.kotIds) window.open(`/kot/${id}`, "_blank", "noopener")
  }

  function cancelTicket(ticket: KotTicket, reason: string) {
    if (!ticket.orderId) return
    const orderId = ticket.orderId
    // Void every still-live line through the audited RPC (manager-gated, records
    // the reason, restores stock, recomputes the bill). One failure stops and
    // surfaces — a half-cancelled ticket is worse than none, and the RPC is
    // idempotent so a retry is safe.
    const targets = ticket.lines.filter((l) => !l.isVoid && l.orderItemId)
    startTransition(async () => {
      for (const l of targets) {
        const res = await voidLine(orderId, l.orderItemId as string, reason)
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {showCompleted ? "All tickets" : "Pending orders"}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={showCompleted ? "default" : "outline"}
            aria-pressed={showCompleted}
            className="min-h-11"
            onClick={() => setShowCompleted((v) => !v)}
          >
            Completed KOTs
          </Button>
          <Button
            type="button"
            variant={splitByType ? "default" : "outline"}
            aria-pressed={splitByType}
            className="min-h-11"
            onClick={() => setSplitByType((v) => !v)}
          >
            Split KOT by type
          </Button>
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
          <ChefHatIcon className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-base font-semibold">
            {showCompleted ? "No tickets yet" : "No pending tickets"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {showCompleted
              ? "Fire an order and its kitchen tickets show up here."
              : "Everything fired has been served. Toggle Completed KOTs to see the rest."}
          </p>
        </div>
      ) : (
        <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3")}>
          {tickets.map((t) => (
            <KotCard
              key={t.key}
              ticket={t}
              timeZone={timeZone}
              pending={pending}
              onStatus={(status) => changeStatus(t, status)}
              onPrint={() => printTicket(t)}
              onCancel={(reason) => cancelTicket(t, reason)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
