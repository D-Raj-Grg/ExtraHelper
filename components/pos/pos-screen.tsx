"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { PlusIcon, WifiOffIcon } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import {
  ACTIVE_ORDER_STATUSES,
  completedOrdersQuery,
  isKotCompleted,
  ORDER_CARD_SELECT,
} from "@/lib/pos-constants"
import { loadMenuCache, saveMenuCache } from "@/lib/offline/menu-cache"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useOffline } from "@/components/offline-sync-provider"
import { OrdersTab } from "@/components/pos/orders-tab"
import { TableTab } from "@/components/pos/table-tab"
import { KotTab } from "@/components/pos/kot-tab"
import { CompletedTab } from "@/components/pos/completed-tab"
import { PosTabs, type PosTab } from "@/components/pos/pos-tabs"
import { OrderModal, type PosModalState } from "@/components/pos/order-modal"
import { usePosRealtime } from "@/components/pos/use-pos-realtime"
import type {
  PosCompletedOrder,
  PosData,
  PosOrderCard,
  PosOrderDetail,
} from "@/components/pos/types"


/**
 * The POS surface: a board of active orders, and the composer over it.
 *
 * /pos and /pos/[orderId] both render this — the route only decides whether the
 * modal starts open. So a card tap opens the composer with no navigation, and
 * a pasted deep link still works.
 */
export function PosScreen({
  data,
  currency,
  timeZone,
  dayCutoffMinutes = 0,
  tenantId,
  openOrderId = null,
  startNew = false,
  initialDetail = null,
  initialTab = "orders",
}: {
  data: PosData
  currency: string
  timeZone: string
  /** Minutes past local midnight the trading day turns over. Must match the
      server's `tenant_day_start`, or the refetch scopes a different day. */
  dayCutoffMinutes?: number
  tenantId: string
  /** Set ⇒ we arrived by deep link and the modal opens on this order. */
  openOrderId?: string | null
  /** ?new=1 ⇒ the sidebar CTA sent us here to compose straight away. */
  startNew?: boolean
  initialDetail?: PosOrderDetail | null
  /** ?tab= ⇒ which pane opens first (deep-link / refresh safe). */
  initialTab?: PosTab
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { online } = useOffline()
  const [tab, setTab] = useState<PosTab>(initialTab)

  // Tab switches are pure client state — no server round trip. The URL is kept
  // in sync with history.replaceState so a refresh or a shared link reopens the
  // same pane, without re-running the server component on every tap.
  const selectTab = useCallback(
    (next: PosTab) => {
      setTab(next)
      if (typeof window !== "undefined") {
        const url = next === "orders" ? pathname : `${pathname}?tab=${next}`
        window.history.replaceState(null, "", url)
      }
    },
    [pathname],
  )

  const [modal, setModal] = useState<PosModalState>(
    openOrderId ? { mode: "amend", orderId: openOrderId } : startNew ? { mode: "create" } : null,
  )

  // The route has to be able to drive the modal, not just seed it. This
  // component stays mounted across /pos → /pos/[orderId] (same layout), so a
  // useState initializer alone would run once and then ignore every later route
  // change — which silently breaks the reopen-after-confirm and any client-side
  // deep link. Adjusted during render; an effect would paint the wrong pane
  // first. A card tap doesn't navigate, so routeKey is unchanged and this
  // doesn't fight it.
  const routeKey = openOrderId ?? (startNew ? "new" : "")
  const [seenRouteKey, setSeenRouteKey] = useState(routeKey)
  if (seenRouteKey !== routeKey) {
    setSeenRouteKey(routeKey)
    setModal(openOrderId ? { mode: "amend", orderId: openOrderId } : startNew ? { mode: "create" } : null)
  }
  const [orders, setOrders] = useState<PosOrderCard[]>(data.orders)
  const [completed, setCompleted] = useState<PosCompletedOrder[]>(data.completed)

  // Offline fallbacks, so a warm tab keeps working when the server props are
  // empty because the fetch failed.
  const [menu, setMenu] = useState(data.menu)
  const [tables, setTables] = useState(data.tables)
  const [categories, setCategories] = useState(data.categories)
  const [floors, setFloors] = useState(data.floors)

  // Reseeding from props is derived state, so it happens during render — an
  // effect would paint the previous menu for a frame first.
  const [seed, setSeed] = useState(data)
  if (seed !== data) {
    setSeed(data)
    setOrders(data.orders)
    setCompleted(data.completed)
    if (data.menu.length > 0) {
      setMenu(data.menu)
      setTables(data.tables)
      setCategories(data.categories)
      setFloors(data.floors)
    }
  }

  // The effect keeps only the genuinely external work: write the cache when
  // we're online, read it when the server gave us nothing.
  useEffect(() => {
    if (data.menu.length > 0) {
      void saveMenuCache({
        items: data.menu,
        tables: data.tables,
        categories: data.categories,
        floors: data.floors,
      })
      return
    }
    let cancelled = false
    void loadMenuCache().then((c) => {
      if (cancelled || !c) return
      setMenu(c.items)
      setTables(c.tables)
      setCategories(c.categories ?? [])
      setFloors(c.floors ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [data.menu, data.tables, data.categories, data.floors])

  const refetchOrders = useCallback(async () => {
    const supabase = createClient()
    const { data: rows } = await supabase
      .from("orders")
      // The same select the server page uses — a narrower one here would strip
      // the card bodies on the first live ping.
      .select(ORDER_CARD_SELECT)
      .eq("tenant_id", tenantId)
      .in("status", ACTIVE_ORDER_STATUSES)
      .order("pinned_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("created_at", { referencedTable: "order_items" })
    if (rows) setOrders(rows as unknown as PosOrderCard[])
  }, [tenantId])

  // Unlike refetchOrders above, this one shares the *query* with the server
  // rather than the select string, so the two can't drift at all.
  const refetchCompleted = useCallback(async () => {
    const { data: rows } = await completedOrdersQuery(
      createClient(),
      tenantId,
      timeZone,
      dayCutoffMinutes,
    )
    if (rows) setCompleted(rows as unknown as PosCompletedOrder[])
  }, [tenantId, timeZone, dayCutoffMinutes])

  // Read through a ref so the Realtime callback doesn't need `tab` in its deps
  // (usePosRealtime holds the callback in a ref of its own precisely so the
  // channel isn't torn down and rebuilt on every render).
  const tabRef = useRef(tab)
  useEffect(() => {
    tabRef.current = tab
  }, [tab])

  usePosRealtime(tenantId, () => {
    void refetchOrders()
    // Only while the pane is on screen — the board shouldn't pay for a list
    // nobody is looking at. Billing an order is an `orders` UPDATE, so the
    // existing channel already covers this; a *payment* writes bills/payments
    // instead, and the Bill badge catches up on the hook's 45s safety tick.
    if (tabRef.current === "completed" || tabRef.current === "table") void refetchCompleted()
  })

  // Opening the tab pulls fresh: the seed is as old as the last server render.
  // Scheduled rather than awaited inline, the same way KotTab does its
  // mount refetch — a bare call reads to the lint rule as setState-in-effect.
  useEffect(() => {
    // The Table board reads the same set for its unpaid-bill links, so it pulls
    // too — a table showing "Bill unpaid" against a bill settled on another
    // till is worse than a round trip.
    if (tab !== "completed" && tab !== "table") return
    const t = setTimeout(() => void refetchCompleted(), 0)
    return () => clearTimeout(t)
  }, [tab, refetchCompleted])

  const close = useCallback(() => {
    setModal(null)
    // Deep-linked in? Drop back to the board rather than leaving a modal-less
    // /pos/[id] (or a ?new=1 that reopens on refresh) behind. The grid is
    // already underneath, so there's no flash.
    if (openOrderId || startNew) router.replace("/pos")
    else {
      void refetchOrders()
      // The modal can now amend a *billed* order, which lives on the Completed
      // tab, not the board — so refetching only the active orders leaves the
      // row the cashier just changed showing its old count and total. Realtime
      // catches up a beat later; this closes the gap it's visible for.
      if (tab === "completed" || tab === "table") void refetchCompleted()
    }
  }, [openOrderId, startNew, router, refetchOrders, tab, refetchCompleted])

  const posData: PosData = { ...data, menu, tables, categories, floors, orders, completed }

  // No `completed` key: see PosTabs — a badge there would be a today-total that
  // only ever climbs, competing with the two counts that mean "act on me".
  const counts: Partial<Record<PosTab, number>> = {
    orders: orders.length,
    table: tables.length,
    // Same predicate the KOT tab partitions on, so the badge and the tab agree.
    kot: posData.kots.filter((k) => !isKotCompleted(k)).length,
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PosTabs value={tab} onChange={selectTab} counts={counts} />
          {!online ? (
            <Badge className="gap-1.5 border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <WifiOffIcon className="size-3.5" aria-hidden />
              Offline
            </Badge>
          ) : null}
        </div>
        <Button onClick={() => setModal({ mode: "create" })}>
          <PlusIcon />
          Add new order
        </Button>
      </div>

      {/* Four panes now — a nested ternary chain stops being readable here. */}
      {tab === "orders" ? (
        <OrdersTab
          orders={orders}
          currency={currency}
          timeZone={timeZone}
          menuEmpty={menu.length === 0}
          online={online}
          onOpen={(orderId) => setModal({ mode: "amend", orderId })}
          onNew={() => setModal({ mode: "create" })}
        />
      ) : null}

      {tab === "table" ? (
        <TableTab
          tables={tables}
          floors={floors}
          orders={orders}
          billed={completed}
          onOpenOrder={(orderId) => setModal({ mode: "amend", orderId })}
          onNewForTable={(tableId) => setModal({ mode: "create", tableId })}
        />
      ) : null}

      {tab === "kot" ? (
        <KotTab
          initialKots={posData.kots}
          staff={data.staff}
          timeZone={timeZone}
          dayCutoffMinutes={dayCutoffMinutes}
          tenantId={tenantId}
        />
      ) : null}

      {tab === "completed" ? (
        <CompletedTab
          orders={completed}
          currency={currency}
          timeZone={timeZone}
          dayCutoffMinutes={dayCutoffMinutes}
          canCheckout={data.canCheckout}
          onGoToOrders={() => selectTab("orders")}
          onAmend={(orderId) => setModal({ mode: "amend", orderId })}
        />
      ) : null}

      <OrderModal
        state={modal}
        onClose={close}
        data={posData}
        currency={currency}
        tenantId={tenantId}
        initialDetail={initialDetail}
      />
    </>
  )
}
