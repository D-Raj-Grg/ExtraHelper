"use client"

import { useRef, useState, useTransition } from "react"
import { attachCustomer, redeemPoints } from "@/app/(app)/bill/actions"
import { money } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Customer = { id: string; name: string | null; phone: string | null; points: number }

/**
 * Loyalty panel on the bill: attach a customer (dine-in orders have none), then
 * redeem points as a 'points' payment. Rate + burn are enforced server-side
 * (redeem_points_for_bill caps by balance and outstanding due, atomically).
 */
export function BillLoyalty({
  billId,
  currency,
  due,
  pointsValueCents,
  customer,
}: {
  billId: string
  currency: string
  due: number
  pointsValueCents: number
  customer: Customer | null
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [pts, setPts] = useState("")

  function guard(fn: () => Promise<{ error: string } | { ok: true } | undefined>) {
    if (inFlight.current) return
    inFlight.current = true
    setError(null)
    startTransition(async () => {
      try {
        const res = await fn()
        if (res && "error" in res) setError(res.error)
      } finally {
        inFlight.current = false
      }
    })
  }

  if (!customer) {
    return (
      <div className="mt-4 rounded-lg border border-dashed p-3">
        <p className="mb-2 text-sm font-medium">Loyalty — attach customer</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="max-w-32"
          />
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            className="max-w-32"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => guard(() => attachCustomer(billId, name, phone))}
          >
            Attach
          </Button>
        </div>
        {error ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  const rate = Math.max(1, pointsValueCents)
  const maxRedeemable = Math.min(customer.points, Math.floor(due / rate))
  const entered = Math.max(0, Math.min(maxRedeemable, Math.floor(Number(pts) || 0)))

  return (
    <div className="mt-4 rounded-lg border border-dashed p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">Loyalty · {customer.name ?? "Customer"}</p>
        <span className="text-xs text-muted-foreground">
          {customer.points} pts (≈ {money(customer.points * rate, currency)})
        </span>
      </div>
      {maxRedeemable <= 0 ? (
        <p className="text-sm text-muted-foreground">
          {customer.points <= 0 ? "No points to redeem." : "Points value below the amount due."}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="number"
            min={1}
            max={maxRedeemable}
            value={pts}
            onChange={(e) => setPts(e.target.value)}
            placeholder={`${maxRedeemable}`}
            className="max-w-24"
          />
          <span className="text-sm text-muted-foreground">
            of {maxRedeemable} · ≈ {money(entered * rate, currency)}
          </span>
          <Button
            size="sm"
            disabled={pending || entered <= 0}
            onClick={() => guard(() => redeemPoints(billId, entered))}
          >
            Redeem
          </Button>
        </div>
      )}
      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
