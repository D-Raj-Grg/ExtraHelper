"use client"

import { BellIcon, CheckIcon, ClockIcon, FlameIcon, XIcon } from "lucide-react"
import { kotStatusMeta } from "@/lib/kds-constants"
import { cn } from "@/lib/utils"

const ICONS = {
  clock: ClockIcon,
  flame: FlameIcon,
  bell: BellIcon,
  check: CheckIcon,
} as const

/**
 * The icon half of a status. Every place that colours a status pairs it with
 * this — colour alone is unreadable in a badly-lit kitchen and to a colourblind
 * cook, so the shape carries the meaning and the hue only reinforces it.
 * A voided dish falls outside the enum and gets the X.
 */
export function StatusIcon({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const meta = kotStatusMeta(status)
  const Icon = meta ? ICONS[meta.icon] : XIcon
  return <Icon className={cn("size-4", className)} aria-hidden />
}
