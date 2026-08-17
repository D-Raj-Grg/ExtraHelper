"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { CheckCircle2Icon, ChefHatIcon, FlameIcon } from "lucide-react"
import { toast } from "sonner"

import { bumpKot } from "@/app/(app)/kds/actions"
import { voidLine } from "@/app/(app)/pos/actions"
import { createClient } from "@/lib/supabase/client"
import { isKotCompleted, kotTabQuery, KOT_HISTORY_ORDER_STATUSES } from "@/lib/pos-constants"
import { KOT_FLOW } from "@/lib/kds-constants"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { usePrint } from "@/components/print/use-print"
import { KotCard, type KotTicket, type KotTicketLine } from "@/components/pos/kot-card"
import { Frame } from "@/components/pos/pos-empty-state"
import { SegmentedControl } from "@/components/pos/segmented-control"
import type { PosKot, PosStaff } from "@/components/pos/types"

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
  const { printKots } = usePrint()
  const [view, setView] = useState<"active" | "completed">("active")
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
    const { data } = await kotTabQuery(createClient(), tenantId, timeZone)
    if (data) setKots(data as unknown as PosKot[])
  }, [tenantId, timeZone])

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

  // Partitioned on isKotCompleted, not on the ticket's own status: a `ready`
  // ticket whose order has since been settled is history, and filtering on
  // KOT_ACTIVE_STATUSES alone left it sitting on the active pass forever.
  // `billed` is not settled, though — a round ordered after the bill went out
  // fires a real ticket onto a `billed` order, and it belongs on the live pass.
  const done = kots.filter(isKotCompleted)
  const live = kots.filter((k) => !isKotCompleted(k))
  const visible = view === "completed" ? done : live

  const tickets: KotTicket[] = useMemo(() => {
    const meta = (k: PosKot) => ({
      tableLabel: k.orders?.restaurant_tables?.label ?? null,
      orderType: k.orders?.order_type ?? "dine_in",
      staffName: (k.orders?.waiter_id && staffName.get(k.orders.waiter_id)) || "Staff",
      // Same rule that decides whether the ticket is live at all. It used to
      // withdraw cancel for `billed` too, on the reasoning that a void can't
      // recompute a paid bill — but `void_order_item` recomputes for any bill
      // that isn't `paid` (20260712100000), and a billed-but-unpaid order now
      // carries live tickets. Refusing there left cooks looking at work on the
      // pass with the one control that clears it greyed out.
      canCancel: !KOT_HISTORY_ORDER_STATUSES.includes(k.orders?.status ?? ""),
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
    // A confirmed print stamps printed_at — Realtime then lights the printed
    // badge. Always a re-print here: the ticket already went out on fire.
    void printKots(ticket.kotIds, { reprint: true })
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
        <div className="flex flex-wrap items-center gap-2">
          {/* Two views, not a hidden toggle: "where did my ticket go?" was
              unanswerable when the completed half was behind an off-by-default
              button that named itself rather than the view it opened. */}
          <SegmentedControl
            ariaLabel="Ticket view"
            value={view}
            onChange={setView}
            items={[
              { key: "active", label: "Active", icon: FlameIcon, count: live.length },
              { key: "completed", label: "Completed", icon: CheckCircle2Icon, count: done.length },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Stays a toggle: it modifies how the visible tickets are grouped,
              it doesn't select which set you're looking at. */}
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
        <Frame icon={<ChefHatIcon className="size-8 text-muted-foreground" aria-hidden />}>
          <p className="text-base font-semibold">
            {view === "completed" ? "No tickets finished today" : "Nothing on the pass"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {view === "completed"
              ? "Fire an order and its kitchen tickets land here once the kitchen bumps them through, or once the bill is settled."
              : "Everything fired has been served. Switch to Completed to look back over today's tickets."}
          </p>
        </Frame>
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
