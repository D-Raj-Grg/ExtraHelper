"use client"

import { UsersIcon, ArmchairIcon, UserCogIcon, UtensilsCrossedIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { DangerData } from "./types"

/** Initials for the monogram — no photo needed, mirrors the POS tile fallback. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Restaurant identity card: monogram + name + plan badge. */
export function RestaurantHeaderCard({
  name,
  planLabel,
}: {
  name: string
  planLabel: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-heading text-lg font-semibold text-primary">
        {initials(name)}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-heading text-base font-semibold">{name}</span>
        <span>
          <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
            {planLabel}
          </Badge>
        </span>
      </div>
    </div>
  )
}

type Row = {
  key: string
  label: string
  icon: typeof UsersIcon
  used: number
  limit: number | null
}

/** One usage meter: label + icon, a bar, and the figure. Colour never alone —
 * the number and the over/near state word carry it too. */
function UsageRow({ label, icon: Icon, used, limit }: Row) {
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const over = limit != null && used >= limit
  const near = limit != null && !over && used / limit >= 0.8
  const barColor = over ? "bg-destructive" : near ? "bg-amber-500" : "bg-emerald-500"

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {label}
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {used}
          <span className="text-muted-foreground">
            {limit != null ? `/${limit}` : ""}
          </span>
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
        aria-label={`${label}: ${used}${limit != null ? ` of ${limit}` : ""}`}
      >
        <div
          className={cn("h-full rounded-full transition-[width] motion-reduce:transition-none", barColor)}
          style={{ width: limit != null ? `${pct}%` : "0%" }}
        />
      </div>
    </div>
  )
}

/** Customers / Tables / Staff / Menu usage against plan limits. */
export function ResourceUsageCard({ data }: { data: DangerData }) {
  const rows: Row[] = [
    { key: "customers", label: "Customers", icon: UsersIcon, used: data.usage.customers, limit: data.limits.customers },
    { key: "tables", label: "Tables", icon: ArmchairIcon, used: data.usage.tables, limit: data.limits.tables },
    { key: "staff", label: "Staff Members", icon: UserCogIcon, used: data.usage.staff, limit: data.limits.staff },
    { key: "menu", label: "Menu Items", icon: UtensilsCrossedIcon, used: data.usage.menuItems, limit: data.limits.menuItems },
  ]
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-3 text-sm font-semibold">Resource usage</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map(({ key, ...r }) => (
          <UsageRow key={key} {...r} />
        ))}
      </div>
    </div>
  )
}
