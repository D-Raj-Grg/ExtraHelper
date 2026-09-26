"use client"

import Link from "next/link"
import {
  BadgeCheckIcon,
  BellIcon,
  BellRingIcon,
  ChefHatIcon,
  CircleXIcon,
  HandPlatterIcon,
  ReceiptIcon,
  ShoppingBagIcon,
  type LucideIcon,
} from "lucide-react"

import { money, relativeTime } from "@/lib/format"
import {
  notificationKindLabel,
  notificationTone,
  type AppNotification,
} from "@/lib/notification-constants"
import { cn } from "@/lib/utils"

const KIND_ICON: Record<string, LucideIcon> = {
  order_new: ShoppingBagIcon,
  order_preparing: ChefHatIcon,
  order_ready: BellRingIcon,
  order_served: HandPlatterIcon,
  order_billed: ReceiptIcon,
  bill_paid: BadgeCheckIcon,
  order_cancelled: CircleXIcon,
}

/**
 * One notification, shared by the header bell and the /notifications feed.
 *
 * Unread is carried by weight + a dot + screen-reader text, never by colour
 * alone; the per-kind icon carries the step, the tinted chip only reinforces
 * it. Rows are ≥44px tall — this is tapped mid-service on a phone.
 *
 * Renders as a link when there is somewhere to go, a button when there is only
 * something to do (mark read), and plain content otherwise.
 */
export function NotificationRow({
  n,
  now,
  timezone,
  currency,
  unread = false,
  href,
  onSelect,
}: {
  n: AppNotification
  /** From the shared minute clock (`lib/clock.ts`); null during SSR. */
  now: number | null
  timezone: string
  currency: string
  unread?: boolean
  href?: string | null
  onSelect?: () => void
}) {
  const Icon = KIND_ICON[n.kind] ?? BellIcon
  const rowClass = cn(
    "flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left",
    (href || onSelect) &&
      "transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none motion-reduce:transition-none",
  )

  const content = (
    <>
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
          notificationTone(n.kind),
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
            {n.title}
            <span className="sr-only">
              {n.title === notificationKindLabel(n.kind)
                ? unread
                  ? ", unread"
                  : ""
                : ` (${notificationKindLabel(n.kind)}${unread ? ", unread" : ""})`}
            </span>
          </span>
          {n.amount_cents !== null ? (
            <span className="ml-auto shrink-0 text-sm font-medium tabular-nums">
              {money(n.amount_cents, currency)}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{n.body}</span>
          <span aria-hidden>·</span>
          <time dateTime={n.created_at} className="shrink-0 tabular-nums">
            {relativeTime(n.created_at, now, timezone)}
          </time>
        </span>
      </span>
      {/* Unread dot — reinforces the bold title, never the only signal. */}
      <span
        aria-hidden
        className={cn(
          "mt-2 size-2 shrink-0 rounded-full",
          unread ? "bg-primary" : "bg-transparent",
        )}
      />
    </>
  )

  if (href) {
    return (
      <Link href={href} onClick={onSelect} className={rowClass}>
        {content}
      </Link>
    )
  }
  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} className={rowClass}>
        {content}
      </button>
    )
  }
  return <div className={rowClass}>{content}</div>
}
