"use client"

import { useState, useTransition } from "react"
import { adjustPoints } from "@/app/loyalty/actions"
import { formatDateTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Customer = {
  id: string
  name: string | null
  phone: string | null
  loyalty_accounts: { points_balance: number; tier: string | null }[]
}
type Feedback = {
  id: string
  rating: number | null
  comment: string | null
  created_at: string
  customers: { name: string | null } | null
}

const TIER_STYLES: Record<string, string> = {
  gold: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  silver: "bg-slate-400/10 text-slate-500 dark:text-slate-300",
  bronze: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
}

function CustomerRow({ c }: { c: Customer }) {
  const [pending, startTransition] = useTransition()
  const [pts, setPts] = useState("")
  const acct = c.loyalty_accounts?.[0]
  const balance = acct?.points_balance ?? 0
  const tier = acct?.tier ?? "bronze"

  function go(type: "earn" | "burn") {
    const n = Number(pts)
    if (!Number.isInteger(n) || n <= 0) return
    startTransition(async () => {
      await adjustPoints(c.id, n, type)
      setPts("")
    })
  }

  return (
    <tr className="border-t">
      <td className="px-3 py-2">
        {c.name ?? "Guest"}
        {c.phone ? <span className="block text-xs text-muted-foreground">{c.phone}</span> : null}
      </td>
      <td className="px-3 py-2 font-medium">{balance} pts</td>
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${TIER_STYLES[tier] ?? ""}`}>
          {tier}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <Input
            type="number"
            min={1}
            value={pts}
            onChange={(e) => setPts(e.target.value)}
            placeholder="pts"
            className="h-8 w-16 text-xs"
          />
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => go("earn")}>
            Earn
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => go("burn")}>
            Redeem
          </Button>
        </div>
      </td>
    </tr>
  )
}

export function LoyaltyManager({
  customers,
  feedback,
  timezone,
}: {
  customers: Customer[]
  feedback: Feedback[]
  timezone: string
}) {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-2 text-lg font-semibold">Customers</h2>
        {customers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No customers yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Balance</th>
                  <th className="px-3 py-2 font-medium">Tier</th>
                  <th className="px-3 py-2 font-medium text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <CustomerRow key={c.id} c={c} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Feedback</h2>
        {feedback.length === 0 ? (
          <p className="text-sm text-muted-foreground">No feedback yet.</p>
        ) : (
          <ul className="space-y-2">
            {feedback.map((f) => (
              <li key={f.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {"★".repeat(f.rating ?? 0)}
                    {"☆".repeat(Math.max(0, 5 - (f.rating ?? 0)))}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {f.customers?.name ?? "Guest"} · {formatDateTime(f.created_at, timezone)}
                  </span>
                </div>
                {f.comment ? <p className="mt-1 text-muted-foreground">{f.comment}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
