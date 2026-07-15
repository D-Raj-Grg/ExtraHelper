"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { MinusIcon, PlusIcon, SearchIcon, WifiOffIcon } from "lucide-react"
import { toast } from "sonner"
import { placeStaffOrder } from "@/app/(app)/pos/actions"
import { useOffline } from "@/components/offline-sync-provider"
import {
  loadMenuCache,
  saveMenuCache,
  type CachedMenuItem,
  type CachedTable,
} from "@/lib/offline/menu-cache"
import { money } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DestinationPicker, TAKEAWAY } from "./destination-picker"
import { MenuTile } from "./menu-tile"

/**
 * Fresh idempotency key. Module scope, not the component body: it reads
 * Date.now/Math.random, which must never run during render.
 */
function newKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

/**
 * Order composer that works online AND offline. Menu + tables are cached to
 * IndexedDB whenever loaded online, so a warm tab can still build an order when
 * the connection drops. Online → creates the order immediately (place_staff_order,
 * idempotent) and opens the builder to fire. Offline → queues it; the sync
 * provider replays on reconnect.
 */
export function QuickOrder({
  menu,
  tables,
  currency,
}: {
  menu: CachedMenuItem[]
  tables: CachedTable[]
  currency: string
}) {
  const router = useRouter()
  const { online, enqueueOrder } = useOffline()
  const [pending, startTransition] = useTransition()

  // Fall back to the IndexedDB cache when the server props are empty (offline).
  const [items, setItems] = useState<CachedMenuItem[]>(menu)
  const [tableOpts, setTableOpts] = useState<CachedTable[]>(tables)

  // Reseeding from props is derived state, so it happens during render — an
  // effect would paint the previous menu for a frame first.
  const [seed, setSeed] = useState<CachedMenuItem[]>(menu)
  if (seed !== menu) {
    setSeed(menu)
    if (menu.length > 0) {
      setItems(menu)
      setTableOpts(tables)
    }
  }

  // The effect keeps only the genuinely external work: write the cache when
  // we're online, read it when the server gave us nothing.
  useEffect(() => {
    if (menu.length > 0) {
      void saveMenuCache(menu, tables)
      return
    }
    let cancelled = false
    void loadMenuCache().then((c) => {
      if (cancelled || !c) return
      setItems(c.items)
      setTableOpts(c.tables)
    })
    return () => {
      cancelled = true
    }
  }, [menu, tables])

  const [tableId, setTableId] = useState<string>(TAKEAWAY)
  const [query, setQuery] = useState("")
  const [cart, setCart] = useState<Record<string, number>>({})
  // One idempotency key per submission, reused across retries until it succeeds,
  // so a timed-out-but-committed placement can't create a duplicate order.
  const submitKey = useRef<string | null>(null)

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  const dec = (id: string) =>
    setCart((c) => {
      const n = (c[id] ?? 0) - 1
      const next = { ...c }
      if (n <= 0) delete next[id]
      else next[id] = n
      return next
    })

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items
  }, [items, query])

  const lines = Object.entries(cart)
    .map(([id, qty]) => {
      const it = items.find((i) => i.id === id)
      return it ? { id, name: it.name, qty, cents: it.base_price_cents } : null
    })
    .filter((x): x is { id: string; name: string; qty: number; cents: number } => x !== null)
  const total = lines.reduce((s, l) => s + l.cents * l.qty, 0)
  const count = lines.reduce((s, l) => s + l.qty, 0)

  function clear() {
    submitKey.current = null
    setCart({})
    setTableId(TAKEAWAY)
  }

  function place() {
    const payloadItems = lines.map((l) => ({ item_id: l.id, qty: l.qty }))
    if (payloadItems.length === 0) return
    const label = tableOpts.find((t) => t.id === tableId)?.label
    const labelText = label ? `Table ${label}` : "Takeaway"
    const payload = { tableId: tableId || null, items: payloadItems, label: labelText }

    // Decide from live connectivity (the `online` state can lag the event).
    const offlineNow = typeof navigator !== "undefined" ? !navigator.onLine : !online
    if (offlineNow) {
      void enqueueOrder(payload)
      clear()
      return
    }

    if (!submitKey.current) submitKey.current = newKey()
    const key = submitKey.current

    startTransition(async () => {
      try {
        const res = await placeStaffOrder(key, tableId || null, payloadItems)
        if ("error" in res) {
          toast.error(res.error) // keep cart + key so a retry reuses the key
          return
        }
        const id = res.orderId
        clear()
        router.push(`/pos/${id}`)
      } catch {
        // Network failure (maybe committed, maybe not) — queue with the SAME key
        // so replay dedups against any partial commit. Never silently lost.
        await enqueueOrder(payload, key)
        clear()
      }
    })
  }

  const destination = tableOpts.find((t) => t.id === tableId)

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <DestinationPicker tables={tableOpts} value={tableId} onChange={setTableId} />
          {!online ? (
            <Badge className="gap-1.5 border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <WifiOffIcon className="size-3.5" />
              Offline — orders queue
            </Badge>
          ) : null}
        </div>

        {items.length > 0 ? (
          <div className="relative mb-4">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Label htmlFor="pos-search" className="sr-only">
              Search the menu
            </Label>
            <Input
              id="pos-search"
              className="h-11 pl-9"
              placeholder="Search the menu…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        ) : null}

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="font-medium">Menu not cached yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Open POS once while online and it&apos;ll keep working if the connection drops.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing matches “{query}”.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((m) => (
              <MenuTile
                key={m.id}
                item={m}
                qty={cart[m.id] ?? 0}
                currency={currency}
                onAdd={() => add(m.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Cart. Sticks on desktop so the total stays put while the grid scrolls. */}
      <div className="flex flex-col rounded-xl border bg-card p-4 lg:sticky lg:top-6">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="font-semibold">New order</h3>
          <span className="text-sm text-muted-foreground">
            {destination ? `Table ${destination.label}` : "Takeaway"}
          </span>
        </div>

        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Tap a dish to start the order.
          </p>
        ) : (
          <ul className="mb-3 flex flex-col gap-3">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{l.name}</span>
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {money(l.cents * l.qty, currency)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-11"
                    onClick={() => dec(l.id)}
                    aria-label={`One less ${l.name}`}
                  >
                    <MinusIcon className="size-4" />
                  </Button>
                  <span
                    aria-label={`${l.qty} ${l.name}`}
                    className="w-6 text-center text-sm font-semibold tabular-nums"
                  >
                    {l.qty}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-11"
                    onClick={() => add(l.id)}
                    aria-label={`One more ${l.name}`}
                  >
                    <PlusIcon className="size-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto border-t pt-3">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Subtotal</span>
            <span className="text-xl font-bold tabular-nums">{money(total, currency)}</span>
          </div>
          <Button
            className="h-12 w-full text-base"
            disabled={pending || count === 0}
            onClick={place}
          >
            {pending
              ? "Placing…"
              : count === 0
                ? "Place order"
                : `${online ? "Place" : "Queue"} order · ${count}`}
          </Button>
        </div>
      </div>
    </div>
  )
}
