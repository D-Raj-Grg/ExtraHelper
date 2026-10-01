import { BanIcon, CheckIcon, ClockIcon, PauseIcon, TicketPercentIcon } from "lucide-react"

import type { CouponStats } from "@/lib/coupon-constants"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"

type Stat = {
  label: string
  value: string
  note?: string
  icon: React.ReactNode
  tone: string
}

/**
 * Where every coupon stands, at a glance: campaign coupons and flyer-run codes
 * counted together. Icon + word + number, never colour alone.
 */
export function CouponStatsCards({ stats, currency }: { stats: CouponStats; currency: string }) {
  const items: Stat[] = [
    {
      label: "Active",
      value: String(stats.active),
      note: stats.scheduled > 0 ? `${stats.scheduled} not started yet` : "Can be redeemed now",
      icon: <CheckIcon />,
      tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    },
    {
      label: "Redeemed",
      value: String(stats.redemptions),
      note: `${money(stats.discount_given_cents, currency)} given away`,
      icon: <TicketPercentIcon />,
      tone: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    },
    {
      label: "Used up",
      value: String(stats.used_up),
      note: "Reached their limit",
      icon: <BanIcon />,
      tone: "bg-muted text-muted-foreground",
    },
    {
      label: "Expired",
      value: String(stats.expired),
      note: "Past their end date",
      icon: <ClockIcon />,
      tone: "bg-muted text-muted-foreground",
    },
    {
      label: "Paused",
      value: String(stats.paused),
      note: "Switched off",
      icon: <PauseIcon />,
      tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    },
  ]

  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Coupon totals">
      {items.map((s) => (
        <li key={s.label} className={cn(s.label === "Active" && "col-span-2 md:col-span-1")}>
          <Card className="h-full">
            <CardContent className="flex flex-col gap-1 p-4">
              <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium [&>svg]:size-3.5", s.tone)}>
                {s.icon}
                {s.label}
              </span>
              <span className="text-3xl font-bold tabular-nums">{s.value}</span>
              {s.note ? <span className="text-xs text-muted-foreground">{s.note}</span> : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
