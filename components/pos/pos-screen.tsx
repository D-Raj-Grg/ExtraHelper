"use client"

import { useCallback, useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { PlusIcon, WifiOffIcon } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { ACTIVE_ORDER_STATUSES, ORDER_CARD_SELECT } from "@/lib/pos-constants"
import { loadMenuCache, saveMenuCache } from "@/lib/offline/menu-cache"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useOffline } from "@/components/offline-sync-provider"
import { OrdersTab } from "@/components/pos/orders-tab"
import { TableTab } from "@/components/pos/table-tab"
import { KotTab } from "@/components/pos/kot-tab"
import { PosTabs, type PosTab } from "@/components/pos/pos-tabs"
import { OrderModal, type PosModalState } from "@/components/pos/order-modal"
import { usePosRealtime } from "@/components/pos/use-pos-realtime"
import type { PosData, PosOrderCard, PosOrderDetail } from "@/components/pos/types"

const KOT_ACTIVE = ["new", "preparing", "ready"]

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
  tenantId,
  openOrderId = null,
  startNew = false,
  initialDetail = null,
  initialTab = "orders",
}: {
  data: PosData
  currency: string
  timeZone: string
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

  usePosRealtime(tenantId, () => void refetchOrders())

  const close = useCallback(() => {
    setModal(null)
    // Deep-linked in? Drop back to the board rather than leaving a modal-less
    // /pos/[id] (or a ?new=1 that reopens on refresh) behind. The grid is
    // already underneath, so there's no flash.
    if (openOrderId || startNew) router.replace("/pos")
    else void refetchOrders()
  }, [openOrderId, startNew, router, refetchOrders])

  const posData: PosData = { ...data, menu, tables, categories, floors, orders }

  const counts: Record<PosTab, number> = {
    orders: orders.length,
    table: tables.length,
    kot: posData.kots.filter((k) => KOT_ACTIVE.includes(k.status)).length,
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
      ) : tab === "table" ? (
        <TableTab
          tables={tables}
          floors={floors}
          orders={orders}
          onOpenOrder={(orderId) => setModal({ mode: "amend", orderId })}
          onNewForTable={(tableId) => setModal({ mode: "create", tableId })}
        />
      ) : (
        <KotTab
          initialKots={posData.kots}
          staff={data.staff}
          timeZone={timeZone}
          tenantId={tenantId}
        />
      )}

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
