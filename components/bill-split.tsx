"use client"

import { useState, useTransition } from "react"
import { takePayment } from "@/app/(app)/bill/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type SplitItem = { id: string; description: string; qty: number; total_cents: number }

/** Distribute `total` cents into `n` parts that sum back to `total` exactly. */
function distribute(total: number, n: number): number[] {
  const base = Math.floor(total / n)
  const rem = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0))
}

function freshKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

/**
 * Split the check without any schema: compute each payer's share client-side
 * and record it as its own payment (fresh idempotency key each) against the one
 * bill. record_payment rolls the bill open→partial→paid and closes the order on
 * the final share. Arbitrary-amount split is the plain Amount field above.
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

  // Equal split.
  const [nWays, setNWays] = useState(2)
  const [shares, setShares] = useState<number[] | null>(null)
  const [paid, setPaid] = useState(0)

  // By-item split.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const linesTotal = items.reduce((n, it) => n + it.total_cents, 0)
  const selectedSubtotal = items
    .filter((it) => selected.has(it.id))
    .reduce((n, it) => n + it.total_cents, 0)
  // Proportional share of the WHOLE bill (tax/service/discount included), never
  // more than what's still due (so the last payer settles any rounding).
  const itemShare =
    linesTotal > 0 ? Math.min(due, Math.round((selectedSubtotal / linesTotal) * totalCents)) : 0

  function take(cents: number, method: "cash" | "card", after?: () => void) {
    if (cents <= 0) return
    setError(null)
    startTransition(async () => {
      const res = await takePayment(billId, method, cents, freshKey())
      if (res && "error" in res) setError(res.error)
      else after?.()
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
                setPaid(0)
              }}
            >
              Split {nWays} ways
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {shares.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  Share {i + 1} of {shares.length} · {money(s, currency)}
                </span>
                {i < paid ? (
                  <span className="text-xs text-green-600 dark:text-green-400">paid ✓</span>
                ) : i === paid ? (
                  <span className="flex gap-1">
                    <Button size="sm" disabled={pending} onClick={() => take(s, "cash", () => setPaid(paid + 1))}>
                      Cash
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => take(s, "card", () => setPaid(paid + 1))}
                    >
                      Card
                    </Button>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">waiting</span>
                )}
              </div>
            ))}
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
              <input
                type="checkbox"
                checked={selected.has(it.id)}
                onChange={(e) => {
                  const next = new Set(selected)
                  if (e.target.checked) next.add(it.id)
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
            <span className="font-medium">This payer (incl. tax/service): {money(itemShare, currency)}</span>
            <span className="flex gap-1">
              <Button
                size="sm"
                disabled={pending || itemShare <= 0}
                onClick={() => take(itemShare, "cash", () => setSelected(new Set()))}
              >
                Cash
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || itemShare <= 0}
                onClick={() => take(itemShare, "card", () => setSelected(new Set()))}
              >
                Card
              </Button>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Select each payer&apos;s items, take payment, repeat. The last payer settles any rounding.
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
