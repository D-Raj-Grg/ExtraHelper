"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
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
import { Button } from "@/components/ui/button"

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
  useEffect(() => {
    if (menu.length > 0) {
      setItems(menu)
      setTableOpts(tables)
      void saveMenuCache(menu, tables)
    } else {
      void loadMenuCache().then((c) => {
        if (c) {
          setItems(c.items)
          setTableOpts(c.tables)
        }
      })
    }
  }, [menu, tables])

  const [tableId, setTableId] = useState<string>("")
  const [cart, setCart] = useState<Record<string, number>>({})

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  const dec = (id: string) =>
    setCart((c) => {
      const n = (c[id] ?? 0) - 1
      const next = { ...c }
      if (n <= 0) delete next[id]
      else next[id] = n
      return next
    })

  const lines = Object.entries(cart)
    .map(([id, qty]) => {
      const it = items.find((i) => i.id === id)
      return it ? { id, name: it.name, qty, cents: it.base_price_cents } : null
    })
    .filter((x): x is { id: string; name: string; qty: number; cents: number } => x !== null)
  const total = lines.reduce((s, l) => s + l.cents * l.qty, 0)
  const count = lines.reduce((s, l) => s + l.qty, 0)

  function place() {
    const payloadItems = lines.map((l) => ({ item_id: l.id, qty: l.qty }))
    if (payloadItems.length === 0) return
    const label = tableOpts.find((t) => t.id === tableId)?.label
    const labelText = label ? `Table ${label}` : "Takeaway"

    if (!online) {
      void enqueueOrder({ tableId: tableId || null, items: payloadItems, label: labelText })
      setCart({})
      setTableId("")
      return
    }

    startTransition(async () => {
      const key =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
      const res = await placeStaffOrder(key, tableId || null, payloadItems)
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      setCart({})
      setTableId("")
      router.push(`/pos/${res.orderId}`)
    })
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
      {/* Menu */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <select
            value={tableId}
            onChange={(e) => setTableId(e.target.value)}
            className="border-input dark:bg-input/30 h-9 rounded-md border bg-transparent px-3 text-sm"
          >
            <option value="">Takeaway / pickup</option>
            {tableOpts.map((t) => (
              <option key={t.id} value={t.id}>
                Table {t.label} ({t.state})
              </option>
            ))}
          </select>
          {!online ? (
            <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
              Offline — will queue
            </span>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Menu not cached yet — open POS once online to enable offline ordering.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {items.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={m.is_86}
                onClick={() => add(m.id)}
                className="flex flex-col items-start rounded-lg border p-3 text-left transition hover:bg-accent disabled:opacity-40"
              >
                <span className="text-sm font-medium">{m.name}</span>
                <span className="text-xs text-muted-foreground">
                  {money(m.base_price_cents, currency)}
                  {m.is_86 ? " · 86" : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cart */}
      <div className="flex flex-col rounded-lg border p-4">
        <h3 className="mb-2 text-sm font-semibold">New order</h3>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tap items to add.</p>
        ) : (
          <ul className="mb-3 space-y-2">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex-1">{l.name}</span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => dec(l.id)} className="rounded border px-1.5 leading-none">
                    −
                  </button>
                  <span className="w-5 text-center">{l.qty}</span>
                  <button type="button" onClick={() => add(l.id)} className="rounded border px-1.5 leading-none">
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto border-t pt-3">
          <div className="mb-3 flex justify-between font-semibold">
            <span>Subtotal</span>
            <span>{money(total, currency)}</span>
          </div>
          <Button className="w-full" disabled={pending || count === 0} onClick={place}>
            {pending ? "Placing…" : online ? `Place order · ${count}` : `Queue order · ${count}`}
          </Button>
        </div>
      </div>
    </div>
  )
}
