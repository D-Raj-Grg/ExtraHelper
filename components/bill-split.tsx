"use client"

import { useRef, useState, useTransition } from "react"
import { takePayment } from "@/app/(app)/bill/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"

type SplitItem = { id: string; description: string; qty: number; total_cents: number }

/** Distribute `total` cents into `n` parts that sum back to `total` exactly. */
function distribute(total: number, n: number): number[] {
  const base = Math.floor(total / n)
  const rem = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0))
}

function freshNonce(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

/**
 * Split the check without any schema: compute each payer's share client-side
 * and record it as its own payment against the one bill. record_payment rolls
 * open→partial→paid, closes the order on the final share, and clamps to the
 * outstanding balance so a bill can't be overpaid. Idempotency keys are
 * DETERMINISTIC per share slot, so a double-click on one share de-dups instead
 * of double-charging (identical amounts still differ because the slot differs).
 */
export function BillSplit({
  billId,
  currency,
  due,
  totalCents,
  items,
  disabled,
}: {
  billId: string
  currency: string
  due: number
  totalCents: number
  items: SplitItem[]
  disabled?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<"none" | "equal" | "item">("none")
  // Synchronous re-entrancy guard — `pending` from useTransition flips only on
  // the next render, so a fast double-tap can slip a second call past it.
  const inFlight = useRef(false)

  // Equal split. Nonce is set in the (user-gesture) start handler, never during
  // render, so it stays stable across SSR/hydration.
  const [nWays, setNWays] = useState(2)
  const [shares, setShares] = useState<number[] | null>(null)
  const [eqNonce, setEqNonce] = useState<string>("")
  const [paid, setPaid] = useState(0)

  // By-item split. A per-payer counter (ref) keys each payer's payment.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const itemNonce = useRef<string>("")
  const payerIdx = useRef(0)
  const linesTotal = items.reduce((n, it) => n + it.total_cents, 0)
  const selectedSubtotal = items
    .filter((it) => selected.has(it.id))
    .reduce((n, it) => n + it.total_cents, 0)
  // Proportional share of the WHOLE bill (tax/service/discount included), never
  // more than what's still due (so the last payer settles any rounding).
  const itemShare =
    linesTotal > 0 ? Math.min(due, Math.round((selectedSubtotal / linesTotal) * totalCents)) : 0

  function take(cents: number, method: "cash" | "card", key: string, after?: () => void) {
    if (cents <= 0 || inFlight.current) return
    inFlight.current = true
    setError(null)
    startTransition(async () => {
      try {
        const res = await takePayment(billId, method, cents, key)
        if (res && "error" in res) setError(res.error)
        else after?.()
      } finally {
        inFlight.current = false
      }
    })
  }

  function payItem(cents: number, method: "cash" | "card") {
    if (!itemNonce.current) itemNonce.current = freshNonce()
    const key = `${billId}:item:${itemNonce.current}:${payerIdx.current}`
    take(cents, method, key, () => {
      payerIdx.current += 1
      setSelected(new Set())
    })
  }

  return (
    <div className="mt-4 rounded-lg border border-dashed p-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-medium">Split bill</p>
        <div className="flex gap-1">
          {(["equal", "item"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(mode === m ? "none" : m)
                setShares(null)
                setPaid(0)
                setError(null)
              }}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                mode === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {m === "equal" ? "Equally" : "By item"}
            </button>
          ))}
        </div>
      </div>

      {mode === "equal" ? (
        shares === null ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Ways</span>
            <Input
              type="number"
              min={2}
              max={20}
              value={nWays}
              onChange={(e) => setNWays(Math.max(2, Math.min(20, Number(e.target.value) || 2)))}
              className="max-w-20"
            />
            <span className="text-sm text-muted-foreground">
              ≈ {money(Math.ceil(due / nWays), currency)} each
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || due <= 0}
              onClick={() => {
                setShares(distribute(due, nWays))
                setEqNonce(freshNonce())
                setPaid(0)
              }}
            >
              Split {nWays} ways
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {shares.map((s, i) => {
              // Clamp to live due in case the total shrank mid-split (discount).
              const amt = Math.min(s, due)
              return (
                <div key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    Share {i + 1} of {shares.length} · {money(s, currency)}
                  </span>
                  {i < paid ? (
                    <span className="text-xs text-green-600 dark:text-green-400">paid ✓</span>
                  ) : i === paid ? (
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          take(amt, "cash", `${billId}:eq:${eqNonce}:${i}`, () => setPaid(i + 1))
                        }
                      >
                        Cash
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() =>
                          take(amt, "card", `${billId}:eq:${eqNonce}:${i}`, () => setPaid(i + 1))
                        }
                      >
                        Card
                      </Button>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">waiting</span>
                  )}
                </div>
              )
            })}
            <button
              type="button"
              onClick={() => {
                setShares(null)
                setPaid(0)
              }}
              className="text-xs text-muted-foreground hover:underline"
            >
              reset split
            </button>
          </div>
        )
      ) : null}

      {mode === "item" ? (
        <div className="space-y-1.5">
          {items.map((it) => (
            <label key={it.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={selected.has(it.id)}
                onCheckedChange={(v) => {
                  const next = new Set(selected)
                  if (v === true) next.add(it.id)
                  else next.delete(it.id)
                  setSelected(next)
                }}
              />
              <span className="flex-1">
                {it.qty}× {it.description}
              </span>
              <span className="text-muted-foreground">{money(it.total_cents, currency)}</span>
            </label>
          ))}
          <div className="flex items-center justify-between border-t pt-2 text-sm">
            <span className="font-medium">This payer: {money(itemShare, currency)}</span>
            <span className="flex gap-1">
              <Button size="sm" disabled={pending || itemShare <= 0} onClick={() => payItem(itemShare, "cash")}>
                Cash
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || itemShare <= 0}
                onClick={() => payItem(itemShare, "card")}
              >
                Card
              </Button>
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Last payer? Settle the exact balance:</span>
            <span className="flex gap-1">
              <Button size="sm" variant="outline" disabled={pending || due <= 0} onClick={() => payItem(due, "cash")}>
                Pay remaining {money(due, currency)}
              </Button>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Select each payer&apos;s items, take payment, repeat. Share includes proportional
            tax/service.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
