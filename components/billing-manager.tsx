"use client"

import { useState, useTransition } from "react"
import { subscribe, type BillingState } from "@/app/billing/actions"
import { money, formatDateTime } from "@/lib/format"
import { Button } from "@/components/ui/button"

type Sub = {
  status: string
  current_period_end: string | null
  plans: { code: string; name: string; price_cents: number } | null
} | null
type Plan = {
  code: string
  name: string
  price_cents: number
  features: Record<string, boolean>
  limits: Record<string, number>
}
type Invoice = { id: string; amount_cents: number; status: string; issued_at: string }

const FEATURE_LABELS: Record<string, string> = {
  online_store: "Online storefront",
  loyalty: "Loyalty & CRM",
  advanced_reports: "Advanced reports",
  multi_branch: "Multi-branch",
}

export function BillingManager({
  currency,
  timezone,
  subscription,
  plans,
  invoices,
}: {
  currency: string
  timezone: string
  subscription: Sub
  plans: Plan[]
  invoices: Invoice[]
}) {
  const [pending, startTransition] = useTransition()
  const [interval, setInterval] = useState<"month" | "year">("month")
  const [state, setState] = useState<BillingState>(undefined)
  const currentCode = subscription?.plans?.code

  return (
    <div className="flex flex-col gap-8">
      {/* Current */}
      <section className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Current plan</p>
            <p className="text-xl font-bold">{subscription?.plans?.name ?? "None"}</p>
          </div>
          <span className="rounded-full bg-green-500/10 px-3 py-1 text-sm font-medium capitalize text-green-600 dark:text-green-400">
            {subscription?.status ?? "inactive"}
          </span>
        </div>
        {subscription?.current_period_end ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Renews {formatDateTime(subscription.current_period_end, timezone)}
          </p>
        ) : null}
      </section>

      {/* Plans */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Plans</h2>
          <div className="flex gap-1 text-sm">
            {(["month", "year"] as const).map((i) => (
              <button
                key={i}
                onClick={() => setInterval(i)}
                className={`rounded-md px-2 py-1 ${interval === i ? "bg-primary text-primary-foreground" : "bg-muted"}`}
              >
                {i === "month" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {plans.map((p) => {
            const price = interval === "year" ? p.price_cents * 12 : p.price_cents
            const current = p.code === currentCode
            return (
              <div key={p.code} className={`rounded-lg border p-4 ${current ? "border-primary" : ""}`}>
                <p className="font-semibold">{p.name}</p>
                <p className="mb-2 text-2xl font-bold">
                  {money(price, currency)}
                  <span className="text-sm font-normal text-muted-foreground">/{interval}</span>
                </p>
                <ul className="mb-3 space-y-1 text-xs">
                  {Object.entries(FEATURE_LABELS).map(([k, label]) => (
                    <li key={k} className={p.features[k] ? "" : "text-muted-foreground line-through"}>
                      {p.features[k] ? "✓" : "✗"} {label}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  size="sm"
                  variant={current ? "outline" : "default"}
                  disabled={pending || current}
                  onClick={() =>
                    startTransition(async () => {
                      setState(await subscribe(p.code, interval))
                    })
                  }
                >
                  {current ? "Current plan" : `Choose ${p.name}`}
                </Button>
              </div>
            )
          })}
        </div>
        {state && "error" in state ? (
          <p className="mt-2 text-sm text-destructive" role="alert">{state.error}</p>
        ) : null}
      </section>

      {/* Invoices */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0">
                    <td className="px-3 py-2 text-muted-foreground">{formatDateTime(inv.issued_at, timezone)}</td>
                    <td className="px-3 py-2">{money(inv.amount_cents, currency)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs capitalize text-green-600 dark:text-green-400">
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
