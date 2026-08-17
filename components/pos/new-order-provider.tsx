"use client"

import { createContext, useCallback, useContext, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"

import { fetchComposerData } from "@/app/(app)/pos/actions"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useRequiredTenant } from "@/components/tenant-provider"
import { loadMenuCache, saveMenuCache } from "@/lib/offline/menu-cache"
import type { PosComposerData } from "@/components/pos/types"

/**
 * Loaded on first open, not with the shell. This provider is mounted on every
 * authenticated page, and a static import would put the dish grid, the cart and
 * the whole order-modal chunk (amend flow included) into /settings and /reports.
 * The chunk arrives while the composer data is still in flight, so it costs
 * nothing anyone can see.
 */
const NewOrderPane = dynamic(
  () => import("@/components/pos/order-modal").then((m) => m.NewOrderPane),
  { ssr: false },
)

const AmendPane = dynamic(
  () => import("@/components/pos/order-modal").then((m) => m.AmendPane),
  { ssr: false },
)

type NewOrderApi = {
  /** Open the composer over whatever is on screen. `tableId` preselects a table. */
  openNewOrder: (tableId?: string) => void
  /**
   * Add to an order that already exists, over whatever is on screen.
   *
   * The checkout screen's case: the guest asks for one more water while the
   * cashier is holding the bill. Navigating to /pos to add it costs the bill —
   * and closing the composer there used to land on the board, nowhere near the
   * screen the work started from.
   */
  openAmendOrder: (orderId: string) => void
}

const Ctx = createContext<NewOrderApi | null>(null)

/** Open the order composer — new or amend — from anywhere in the app shell. */
export function useNewOrder(): NewOrderApi {
  const api = useContext(Ctx)
  if (!api) throw new Error("useNewOrder must be used inside NewOrderProvider")
  return api
}

/**
 * The composer, mounted once in the app shell.
 *
 * "New order" in the sidebar means *take an order right now* — from the stock
 * count, from the cash drawer, from a report. Navigating to /pos to do it costs
 * whatever the user was in the middle of, so the composer comes to them instead.
 *
 * /pos keeps its own OrderModal: it also does amend mode and the ?new=1 deep
 * link, and the board underneath needs refetching on close. This one only ever
 * creates.
 */
export function NewOrderProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const tenant = useRequiredTenant()

  const [open, setOpen] = useState(false)
  const [tableId, setTableId] = useState<string | undefined>(undefined)
  /** Set ⇒ amending that order; unset ⇒ composing a new one. */
  const [amendOrderId, setAmendOrderId] = useState<string | null>(null)
  const [data, setData] = useState<PosComposerData | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Mirrors `data` for the async opener to read without depending on it — the
  // callback must stay stable, or every consumer re-renders on each fetch.
  const dataRef = useRef<PosComposerData | null>(null)
  // Bumped on every open, so a fetch that resolves after a close-and-reopen
  // can't stamp its stale payload over a newer one.
  const openSeq = useRef(0)

  const put = useCallback((next: PosComposerData) => {
    dataRef.current = next
    setData(next)
  }, [])

  /**
   * Open the dialog and get the menu in front of it, whichever mode we're in.
   *
   * Both openers need the identical payload — amending needs the dish grid
   * exactly as much as creating does — so the fetch, the warm start and the
   * staleness guard live here once.
   */
  const beginOpen = useCallback(
    () => {
      const seq = ++openSeq.current
      setError(null)
      setOpen(true)

      void (async () => {
        // Warm start, only when there's nothing in memory: a cache blob is
        // older than whatever a previous open already fetched.
        if (!dataRef.current) {
          const cached = await loadMenuCache()
          // The cache and the composer share one type on purpose (types.ts:6-9),
          // so this slots straight in. It carries no customers or staff — the
          // customer picker has its own server-side type-ahead and staff only
          // fills the waiter picker, so both are better empty than blocking.
          if (cached && seq === openSeq.current && !dataRef.current) {
            put({
              menu: cached.items,
              tables: cached.tables,
              categories: cached.categories ?? [],
              floors: cached.floors ?? [],
              customers: [],
              staff: [],
            })
          }
        }

        // Always refetch. Prices and 86 flags move during service, and a
        // composer offering a sold-out dish is how a table gets promised food
        // the kitchen doesn't have.
        try {
          const fresh = await fetchComposerData()
          if (seq !== openSeq.current) return
          if ("error" in fresh) {
            setError(fresh.error)
            return
          }
          put(fresh)
          setError(null)
          await saveMenuCache({
            items: fresh.menu,
            tables: fresh.tables,
            categories: fresh.categories,
            floors: fresh.floors,
          })
        } catch {
          // Offline, or the fetch died. A warm cache still composes fine — the
          // order queues through the offline provider exactly as on /pos, so
          // this only has to say something when there's nothing to show.
          if (seq === openSeq.current && !dataRef.current) {
            setError(
              "You're offline and this device hasn't loaded the menu yet. Open POS once while connected — after that, quick orders work from any screen, online or not.",
            )
          }
        }
      })()
    },
    [put],
  )

  const openNewOrder = useCallback(
    (preselect?: string) => {
      setAmendOrderId(null)
      setTableId(preselect)
      beginOpen()
    },
    [beginOpen],
  )

  const openAmendOrder = useCallback(
    (orderId: string) => {
      setTableId(undefined)
      setAmendOrderId(orderId)
      beginOpen()
    },
    [beginOpen],
  )

  const close = useCallback(() => {
    setOpen(false)
    setTableId(undefined)
    setAmendOrderId(null)
    // The screen behind this may well be the POS board — or a bill whose total
    // just moved, which is why this refresh isn't optional. Cheap everywhere
    // else: /pos is force-dynamic and the add actions already revalidate both.
    router.refresh()
  }, [router])

  return (
    <Ctx.Provider value={{ openNewOrder, openAmendOrder }}>
      {children}
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent size="full">
          {/* Gated on `open`, not just on `data`. The dialog stays mounted
              through its 200ms exit animation, and `close()` clears
              `amendOrderId` in the same batch — without this the amend pane
              would swap to the New order composer, table picker and all, for
              the length of every close. `data` is deliberately never cleared
              (it's the warm menu), so it can't do the gating on its own. */}
          {!open ? null : data && amendOrderId ? (
            <AmendPane
              // Keyed by order id so opening a different order remounts rather
              // than carrying the previous one's state across — same reason
              // OrderModal keys it.
              key={amendOrderId}
              orderId={amendOrderId}
              tenantId={tenant.tenantId}
              data={data}
              currency={tenant.currency}
              onClose={close}
            />
          ) : data ? (
            <NewOrderPane
              data={data}
              currency={tenant.currency}
              onClose={close}
              initialTableId={tableId}
            />
          ) : (
            // Nothing to compose from yet: still fetching, or offline with a
            // cold cache. The message is the difference — one resolves itself,
            // the other needs the user to go online once.
            <>
              <DialogHeader>
                <DialogTitle>
                  {error
                    ? "Can't take an order here"
                    : amendOrderId
                      ? "Add items"
                      : "New order"}
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-1 items-center justify-center p-6">
                <p className="max-w-sm text-center text-sm text-muted-foreground">
                  {error ?? "Loading the menu…"}
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  )
}
