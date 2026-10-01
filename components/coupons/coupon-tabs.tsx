import Link from "next/link"
import { PrinterIcon, TicketPercentIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const TABS = [
  { key: "coupons", label: "Coupons", href: "/coupons", icon: <TicketPercentIcon className="size-4" aria-hidden /> },
  { key: "flyers", label: "Flyers", href: "/coupons/flyers", icon: <PrinterIcon className="size-4" aria-hidden /> },
] as const

/**
 * Coupons and Flyers are two views of the same thing, so they share one tab
 * bar. Real links rather than client state: each tab has its own address, the
 * back button works, and the page behind it loads only what it shows.
 */
export function CouponTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Coupon sections" className="mb-6 flex gap-1 border-b">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex h-11 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
            t.key === active
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.icon}
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
